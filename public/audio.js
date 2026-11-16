'use strict';
/* =====================================================================
   Nexo - processamento de voz (o que sai do SEU microfone)
   ---------------------------------------------------------------------
   Cada pessoa trata o próprio microfone ANTES de enviar. Quem recebe não
   aplica filtro nenhum de novo (nada é processado duas vezes).

   Cadeia:
     microfone ─► volume de entrada ─► filtro de graves ─► SUPRESSOR ─► voz* ─► compressor ─► limitador ─► pressionar-para-falar ─► chamada
                                                    └──────── (sinal original, só para análise) ──┘
     * voz = detecção de voz com 20 ms de antecipação (não corta o começo da palavra),
             proteção contra cliques (tecla/mouse não abrem o microfone) e normalização de volume.

   Supressor por nível (escolhido com medições — veja o relatório):
     off   → nada
     low   → supressão nativa do navegador (WebRTC), a mais natural
     med   → RNNoise (rede neural)          — ótimo para ventilador, ar-condicionado, vento
     high  → GTCRN (rede neural mais nova)  — também tira teclado e cliques de mouse
     auto  → troca sozinho entre nada / RNNoise / GTCRN conforme o ruído medido
   ===================================================================== */

const NS_LEVELS = [
  ['off', 'Desativado', 'Áudio original, sem supressão. Para instrumentos ou microfone de estúdio.'],
  ['low', 'Baixo', 'Supressão nativa do navegador: tira chiado e ruído leve, voz bem natural.'],
  ['med', 'Médio', 'Inteligência artificial (RNNoise): ventilador, ar-condicionado, computador e vento.'],
  ['high', 'Alto', 'Inteligência artificial mais forte (GTCRN): também teclado e cliques de mouse.'],
  ['auto', 'Automático', 'Mede o barulho do seu ambiente e escolhe o nível sozinho.'],
];
const NS_LABEL = Object.fromEntries(NS_LEVELS.map(([k, l]) => [k, l]));
const VENDOR = '/vendor/ns/';

// nível efetivo: a sala pode recomendar um (se a pessoa aceitar seguir a sala)
function effectiveNs() {
  const room = call.channelId && call.vcfg?.ns;
  if (room && prefs.followRoomNs !== false) return room;
  return normNs(prefs.ns);
}
// valores antigos (v15–v19) → novos
const normNs = v => ({ std: 'low', strong: 'high' }[v] || (['off', 'low', 'med', 'high', 'auto'].includes(v) ? v : 'auto'));

function micConstraints(level = effectiveNs()) {
  return {
    deviceId: prefs.mic ? { ideal: prefs.mic } : undefined,
    echoCancellation: prefs.echo !== false,
    noiseSuppression: level === 'low',      // só no "Baixo": nos outros a IA faz isso (sem filtrar duas vezes)
    autoGainControl: false,                 // o volume é normalizado pelo Nexo (não deixa o navegador mexer junto)
    channelCount: 1,
    sampleRate: 48000,
  };
}

// ---------------------------------------------------------------------
// Worklet de voz: detecção de voz + proteção contra cliques + normalização
// ---------------------------------------------------------------------
const VOICE_WORKLET = `
class NexoVoice extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o.processorOptions || {};
    this.mode = p.mode || 'auto'; this.th = p.th ?? -50; this.agc = p.agc !== false; this.guard = p.guard !== false; this.comp = p.comp !== false;
    this.cenv = -100; this.cg = 1; this.lg = 1;
    this.look = Math.round(0.02 * sampleRate);             // 20 ms de antecipação
    this.buf = new Float32Array(this.look + 256); this.w = 0;
    this.env = -100; this.floor = -70; this.rawFloor = -70; this.rawFast = -100; this.rawSlow = -100;
    this.gain = 0; this.hold = 0; this.run = 0;
    this.lvl = 1; this.spPow = Math.pow(10, -2.3); this.n = 0;
    this.cand = null;   // possível clique: { t, peak }
    this.qb = new Float32Array(50); this.qi = -1;   // segundos de silêncio nos últimos 5 s (em fatias de 0,1 s)
    this.hp = 0; this.hpX = 0; this.lp = 0;                 // filtro só para a análise (300 Hz–4 kHz)
    // histórico dos últimos ~3 s para medir o ruído de fundo (percentil 10)
    this.hist = new Float32Array(1100); this.rawHist = new Float32Array(1100); this.hi = 0; this.hn = 0;
    this.imp = []; this.lastImp = 0; this.t = 0;
    this.port.onmessage = e => { const d = e.data || {}; for (const k of ['mode', 'th', 'agc', 'guard', 'comp']) if (k in d) this[k] = d[k]; };
  }
  process(inputs, outputs) {
    const x = inputs[0] && inputs[0][0], raw = inputs[1] && inputs[1][0], out = outputs[0][0];
    if (!out) return true;
    const N = out.length, sr = sampleRate;
    this.t += N / sr;
    if (!x) { out.fill(0); return true; }
    // --- análise do sinal tratado (faixa da voz) ---
    let e = 0;
    const a = Math.exp(-2 * Math.PI * 300 / sr), b = 1 - Math.exp(-2 * Math.PI * 4000 / sr);
    for (let i = 0; i < N; i++) {
      this.hp = a * (this.hp + x[i] - this.hpX); this.hpX = x[i];
      this.lp += b * (this.hp - this.lp);
      e += this.lp * this.lp;
    }
    const db = 10 * Math.log10(e / N + 1e-12);
    this.env = db > this.env ? this.env + (db - this.env) * 0.6 : this.env + (db - this.env) * 0.1;
    let full = 0; for (let i = 0; i < N; i++) full += x[i] * x[i];
    const fdb = 10 * Math.log10(full / N + 1e-12);
    // --- análise do sinal original (para o modo automático) ---
    if (raw) {
      let r = 0; for (let i = 0; i < N; i++) r += raw[i] * raw[i];
      const rd = 10 * Math.log10(r / N + 1e-12);
      this.rawFast = rd;
      this.rawSlow += (rd - this.rawSlow) * 0.02;
      this.rawHist[this.hi] = rd;
      // impulso (tecla, clique): sobe de repente bem acima do normal e some em menos de 30 ms.
      // Sílabas da fala duram mais, então não contam.
      // e depois fica 40 ms em silêncio (um clique é isolado; a fala continua)
      if (!this.cand && rd > this.rawSlow + 12 && rd > this.rawFloor + 18 && this.quiet > 0.04) this.cand = { t: this.t, peak: rd, fell: 0 };
      else if (this.cand) {
        const c = this.cand, age = this.t - c.t;
        if (!c.fell) {
          if (rd > c.peak) c.peak = rd;
          if (rd < c.peak - 12) c.fell = this.t;
          else if (age > 0.03) this.cand = null;
        } else if (rd > c.peak - 8) this.cand = null;                 // voltou a subir: é fala
        else if (this.t - c.fell > 0.04) { if (this.t - this.lastImp > 0.04) { this.imp.push(this.t); this.lastImp = this.t; } this.cand = null; }
      }
      // tempo em silêncio antes (para saber se o som começou "do nada")
      this.quiet = rd < this.rawFloor + 10 ? (this.quiet || 0) + N / sr : 0;
      const bi = Math.floor(this.t * 10) % 50;
      if (bi !== this.qi) { this.qb[bi] = 0; this.qi = bi; }
      if (this.gain < 0.5) this.qb[bi] += N / sr;
      while (this.imp.length && this.t - this.imp[0] > 5) this.imp.shift();
    }
    this.hist[this.hi] = db;
    this.hi = (this.hi + 1) % this.hist.length; this.hn = Math.min(this.hn + 1, this.hist.length);
    // a cada ~0,25 s recalcula o ruído de fundo (o barulho que fica quando ninguém fala)
    if (this.hn > 60 && this.n % 94 === 0) {
      const pct = h => { const a = Array.prototype.slice.call(h, 0, this.hn).sort((p, q) => p - q); return a[Math.floor(a.length * 0.1)]; };
      this.floor = pct(this.hist);
      if (raw) this.rawFloor = pct(this.rawHist);
    }
    // --- detecção de voz ---
    let th;
    if (this.mode === 'manual') th = this.th;
    else th = Math.max(-62, Math.min(-32, this.floor + 11));
    const above = this.mode === 'off' || this.env > th;
    // proteção contra cliques: só abre se o som (instantâneo, não suavizado) durar ~20 ms; um clique dura menos
    this.run = db > th ? this.run + N : 0;
    const need = this.guard && this.mode !== 'off' ? 0.018 * sr : 0;
    const open = this.mode === 'off' || (above && (this.run >= need || this.gain > 0.5));
    if (open) this.hold = 0.32 * sr; else this.hold = Math.max(0, this.hold - N);
    const target = open || this.hold > 0 ? 1 : 0;
    // --- normalização de volume (só aprende enquanto você fala) ---
    // mede o volume da fala (sinal inteiro) e leva para perto de -23 dBFS, no máx. +10 / -6 dB, devagar
    if (this.agc && open && above && fdb > this.floor + 12) {
      this.spPow += (full / N - this.spPow) * 0.003;              // média da POTÊNCIA da fala (~1 s)
      const speech = 10 * Math.log10(this.spPow + 1e-12);
      const want = Math.max(-6, Math.min(9, -21 - speech));
      const cur = 20 * Math.log10(this.lvl);
      this.lvl = Math.pow(10, (cur + (want - cur) * 0.0015) / 20);  // ~2 s para ajustar: não "bombeia"
    } else if (!this.agc) this.lvl = 1;
    // --- saída (atrasada 20 ms: a abertura chega junto com o começo da palavra) ---
    const L = this.buf.length;
    const g0 = this.gain;
    const step = target > g0 ? N / (0.004 * sr) : N / (0.09 * sr);
    this.gain = target > g0 ? Math.min(1, g0 + step) : Math.max(0, g0 - step);
    for (let i = 0; i < N; i++) {
      this.buf[this.w] = x[i];
      const rIdx = (this.w - this.look + L) % L;
      out[i] = this.buf[rIdx] * (g0 + (this.gain - g0) * i / N) * this.lvl;
      this.w = (this.w + 1) % L;
    }
    // --- compressor suave (sem ganho escondido): acima de -16 dBFS, razão 2:1, joelho de 8 dB ---
    let pk = 0, ce = 0;
    for (let i = 0; i < N; i++) { const v = out[i]; ce += v * v; const av = v < 0 ? -v : v; if (av > pk) pk = av; }
    const cdb = 10 * Math.log10(ce / N + 1e-12);
    this.cenv = cdb > this.cenv ? this.cenv + (cdb - this.cenv) * 0.09 : this.cenv + (cdb - this.cenv) * 0.012;   // ~30 ms para agir, ~220 ms para soltar
    let red = 0;
    if (this.comp) {
      const T = -16, R = 2, K = 8, over = this.cenv - T;   // só pega o que passa bem do volume normal da fala
      if (over > K / 2) red = over * (1 - 1 / R);
      else if (over > -K / 2) red = (1 - 1 / R) * (over + K / 2) * (over + K / 2) / (2 * K);
    }
    const cg1 = Math.pow(10, -red / 20);
    // --- limitador: o pico nunca passa de -1 dBFS ---
    const ceil = 0.89, need1 = pk * cg1 > ceil ? ceil / (pk * cg1) : 1;
    const lg1 = need1 < this.lg ? need1 : this.lg + (1 - this.lg) * 0.02;
    const c0 = this.cg, l0 = this.lg;
    for (let i = 0; i < N; i++) {
      const f = i / N;
      let v = out[i] * (c0 + (cg1 - c0) * f) * (lg1 < l0 ? lg1 : l0 + (lg1 - l0) * f);
      out[i] = v > 0.98 ? 0.98 : v < -0.98 ? -0.98 : v;
    }
    this.cg = cg1; this.lg = lg1;
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (++this.n % 12 === 0) this.port.postMessage({ level: this.env, open: this.gain > 0.5, th, floor: this.floor, rawFloor: this.rawFloor, imp: this.imp.length / Math.max(0.6, this.qb.reduce((a, b) => a + b, 0)), agc: 20 * Math.log10(this.lvl) });
    return true;
  }
}
registerProcessor('nexo-voice', NexoVoice);`;

// ---------------------------------------------------------------------
// Carregamento dos módulos (uma vez por contexto de áudio)
// ---------------------------------------------------------------------
const AUD = { mods: new WeakMap(), bins: {} };
const simdOk = (() => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch { return false; } })();
async function bin(name) {
  return AUD.bins[name] ||= fetch(VENDOR + name).then(r => { if (!r.ok) throw new Error('não baixou ' + name); return r.arrayBuffer(); });
}
async function ensureModule(ctx, key) {
  let m = AUD.mods.get(ctx);
  if (!m) AUD.mods.set(ctx, m = {});
  if (!m[key]) {
    m[key] = key === 'voice'
      ? ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([VOICE_WORKLET], { type: 'text/javascript' })))
      : ctx.audioWorklet.addModule(VENDOR + key + '/workletProcessor.js');
  }
  return m[key];
}
// Cria o nó do supressor (null = sem supressor de IA)
async function makeNs(ctx, kind) {
  if (kind === 'rnnoise') {
    await ensureModule(ctx, 'rnnoise');
    const wasmBinary = (await bin(simdOk ? 'rnnoise_simd.wasm' : 'rnnoise.wasm')).slice(0);
    return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', { processorOptions: { maxChannels: 1, wasmBinary } });
  }
  if (kind === 'gtcrn') {
    await ensureModule(ctx, 'gtcrn');
    const wasmBinary = (await bin('gtcrn.wasm')).slice(0);
    return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/gtcrn', { processorOptions: { maxChannels: 1, sampleRate: 48000, wasmBinary } });
  }
  return null;
}
const kindFor = lvl => lvl === 'med' ? 'rnnoise' : lvl === 'high' ? 'gtcrn' : 'none';

// ---------------------------------------------------------------------
// Monta a cadeia (serve para a chamada e para o teste gravado)
// ---------------------------------------------------------------------
async function buildVoiceChain(ctx, src, opt = {}) {
  const level = opt.level || effectiveNs();
  if (ctx.sampleRate !== 48000 && level !== 'off' && level !== 'low') console.warn('áudio em', ctx.sampleRate, 'Hz: a IA espera 48 kHz');
  await ensureModule(ctx, 'voice');
  const inGain = ctx.createGain();
  inGain.gain.value = Math.max(0, Math.min(2, (prefs.inVol ?? 100) / 100));
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.Q.value = 0.707;
  hpf.frequency.value = prefs.hpf === false ? 20 : level === 'high' ? 100 : 80;
  const sum = ctx.createGain();                  // entrada do detector de voz (sinal tratado)
  const voice = new AudioWorkletNode(ctx, 'nexo-voice', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { mode: opt.gate ?? prefs.gate, th: prefs.gateDb, agc: prefs.agc !== false, guard: prefs.clickGuard !== false, comp: prefs.comp !== false },
  });
  src.connect(inGain).connect(hpf);
  hpf.connect(voice, 0, 1);                      // original, só para análise
  sum.connect(voice, 0, 0);
  // compressor e limitador ficam dentro do worklet de voz (sem o ganho automático escondido do compressor do navegador)
  const ptt = ctx.createGain();
  voice.connect(ptt);

  // caminhos do supressor (dá para trocar com "crossfade" sem cortar a voz)
  const chain = { ctx, level, inGain, hpf, sum, voice, ptt, path: null, kind: null, nodes: [inGain, hpf, sum, voice, ptt] };
  chain.setKind = async (kind, fadeMs = 250) => {
    if (chain.kind === kind && chain.path) return;
    const node = kind === 'none' ? null : await makeNs(ctx, kind);
    const g = ctx.createGain(); g.gain.value = chain.path ? 0 : 1;
    if (node) { hpf.connect(node); node.connect(g); } else hpf.connect(g);
    g.connect(sum);
    const old = chain.path;
    chain.path = { node, g }; chain.kind = kind;
    if (old) {
      const t = ctx.currentTime, d = fadeMs / 1000;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + d);
      old.g.gain.setValueAtTime(1, t); old.g.gain.linearRampToValueAtTime(0, t + d);
      setTimeout(() => { try { if (old.node) { hpf.disconnect(old.node); old.node.disconnect(); old.node.destroy?.(); } else hpf.disconnect(old.g); old.g.disconnect(); } catch {} }, fadeMs + 120);
    }
    chain.onKind?.(kind);
  };
  chain.destroy = () => {
    try { chain.path?.node?.destroy?.(); } catch {}
    for (const n of [...chain.nodes, chain.path?.node, chain.path?.g]) try { n?.disconnect(); } catch {}
  };
  await chain.setKind(level === 'auto' ? (opt.autoStart || 'rnnoise') : kindFor(level), 0);
  if (level === 'auto' && !opt.offline) startAuto(chain);
  return chain;
}

// ---------------------------------------------------------------------
// Automático: decide pelo barulho medido (com folga para não ficar trocando)
// ---------------------------------------------------------------------
function autoPick(stat) {
  if (stat.imp >= 1.0 || stat.rawFloor > -42) return 'gtcrn';      // digitando / cliques (por segundo de silêncio) / muito barulho
  if (stat.rawFloor > -62) return 'rnnoise';                         // ruído constante (ventilador etc.)
  return 'none';                                                     // ambiente silencioso
}
function startAuto(chain) {
  let want = null, since = 0, last = performance.now();
  const prev = chain.voice.port.onmessage;
  chain.auto = { stat: null };
  chain.voice.port.addEventListener('message', e => {
    const d = e.data; chain.auto.stat = d;
    const pick = autoPick(d), now = performance.now();
    if (pick === chain.kind) { want = null; return; }
    if (pick !== want) { want = pick; since = now; return; }
    // a condição precisa durar 3 s, e no mínimo 6 s entre trocas
    if (now - since > 3000 && now - last > 6000) { last = now; chain.setKind(pick); }
  });
  chain.voice.port.start?.();
}

// ---------------------------------------------------------------------
// Microfone da chamada
// ---------------------------------------------------------------------
async function processMic(raw, onLevel) {
  ensureAudioCtx();
  const ctx = call.audioCtx;
  try {
    if (!ctx?.audioWorklet) throw new Error('sem AudioWorklet');
    const src = ctx.createMediaStreamSource(new MediaStream([raw]));
    const chain = await buildVoiceChain(ctx, src);
    if (onLevel) chain.voice.port.addEventListener('message', e => onLevel({ ...e.data, kind: chain.kind }));
    chain.voice.port.start?.();
    const dst = ctx.createMediaStreamDestination();
    chain.ptt.connect(dst);
    const track = dst.stream.getAudioTracks()[0];
    Object.assign(track, { _raw: raw, _chain: chain, _gate: chain.voice, _pttGain: chain.ptt, _ns: chain.level });
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); try { raw.stop(); } catch {} chain.destroy(); try { src.disconnect(); dst.disconnect?.(); } catch {} };
    setTimeout(() => { if (typeof applyPtt === 'function' && call.micTrack === track) applyPtt(); }, 0);
    return track;
  } catch (e) {
    console.warn('processamento do microfone indisponível', e);
    return raw;   // navegador sem suporte: manda o microfone como está
  }
}
async function acquireMic(onLevel) {
  const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() });
  return processMic(s.getAudioTracks()[0], onLevel);
}
// Ajustes que valem na hora, sem reabrir o microfone
function updateGate() {
  for (const t of [call.micTrack, ACC?.test?.track]) {
    t?._gate?.port.postMessage({ mode: prefs.gate, th: prefs.gateDb, agc: prefs.agc !== false, guard: prefs.clickGuard !== false, comp: prefs.comp !== false });
    if (t?._chain) t._chain.inGain.gain.value = Math.max(0, Math.min(2, (prefs.inVol ?? 100) / 100));
  }
}
// Entrou numa sala que recomenda outro nível: refaz o microfone
function maybeApplyRoomNs() {
  if (call.micTrack?._ns && call.micTrack._ns !== effectiveNs()) {
    switchMicDevice(true);
    toast(`Esta sala recomenda a supressão de ruído "${NS_LABEL[effectiveNs()]}". Aplicado só aqui.`, 5000);
  }
}

// ---------------------------------------------------------------------
// Teste gravado: grava alguns segundos do microfone SEM tratamento e
// depois passa o MESMO trecho pela cadeia, para comparar de forma justa.
// ---------------------------------------------------------------------
async function recordRaw(seconds, onLevel) {
  ensureAudioCtx();
  const ctx = call.audioCtx;
  // grava o microfone sem nenhuma supressão (o filtro nativo do "Baixo" não dá para aplicar depois numa gravação;
  // testamos: o navegador não grava o mesmo microfone com e sem filtro ao mesmo tempo)
  const base = { deviceId: prefs.mic ? { ideal: prefs.mic } : undefined, echoCancellation: prefs.echo !== false, autoGainControl: false, channelCount: 1 };
  const s1 = await navigator.mediaDevices.getUserMedia({ audio: { ...base, noiseSuppression: false } });
  const s2 = null;
  const code = `class R extends AudioWorkletProcessor{process(i){const a=i[0]&&i[0][0];if(a)this.port.postMessage(a.slice(0));return true}}registerProcessor('nexo-rec',R)`;
  let m = AUD.mods.get(ctx); if (!m) AUD.mods.set(ctx, m = {});
  m.rec ||= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  await m.rec;
  const take = stream => {
    const src = ctx.createMediaStreamSource(stream), rec = new AudioWorkletNode(ctx, 'nexo-rec'), mute = ctx.createGain();
    mute.gain.value = 0; src.connect(rec).connect(mute).connect(ctx.destination);
    const parts = []; rec.port.onmessage = e => parts.push(e.data);
    return { parts, stop: () => { try { src.disconnect(); rec.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach(t => t.stop()); } };
  };
  const a = take(s1), b = s2 ? take(s2) : null;
  const an = ctx.createAnalyser(); an.fftSize = 1024;
  const msrc = ctx.createMediaStreamSource(s1); msrc.connect(an);
  const tb = new Float32Array(an.fftSize);
  const t0 = performance.now();
  await new Promise(res => {
    const tick = () => {
      an.getFloatTimeDomainData(tb);
      let e = 0; for (const v of tb) e += v * v;
      onLevel?.(10 * Math.log10(e / tb.length + 1e-12), (performance.now() - t0) / 1000);
      if (performance.now() - t0 >= seconds * 1000) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });
  a.stop(); b?.stop(); try { msrc.disconnect(); } catch {}
  const join = parts => { const n = parts.reduce((s, p) => s + p.length, 0), y = new Float32Array(n); let o = 0; for (const p of parts) { y.set(p, o); o += p.length; } return y; };
  return { sr: ctx.sampleRate, raw: join(a.parts), nativeNs: b ? join(b.parts) : null };
}
// Analisa o trecho para o "Automático" decidir (igual faria ao vivo)
function analyzeClip(x, sr) {
  // mesma regra do ao vivo: ruído de fundo = percentil 10; clique = sobe do silêncio, cai 12 dB em até 30 ms
  // e fica 40 ms quieto; taxa contada por segundo de silêncio
  const B = Math.round(sr * 0.01), d = [];
  for (let i = 0; i + B <= x.length; i += B) { let e = 0; for (let j = i; j < i + B; j++) e += x[j] * x[j]; d.push(10 * Math.log10(e / B + 1e-12)); }
  const floor = [...d].sort((a, b) => a - b)[Math.floor(d.length * 0.1)] ?? -90;
  let imp = 0, quiet = 0, quietRun = 0, slow = floor;
  for (let i = 1; i < d.length - 8; i++) {
    slow += (d[i] - slow) * 0.05;
    if (d[i] < floor + 10) { quiet++; quietRun++; continue; }
    if (quietRun >= 4 && d[i] > slow + 12 && d[i] > floor + 18) {
      let pk = d[i], k = i, fell = -1;
      for (; k < i + 3; k++) { if (d[k] > pk) pk = d[k]; if (d[k] < pk - 12) { fell = k; break; } }
      if (fell > 0 && d.slice(fell, fell + 4).every(v => v < pk - 8)) imp++;
    }
    quietRun = 0;
  }
  return { rawFloor: floor, imp: imp / Math.max(0.6, quiet * 0.01) };
}
// Passa o trecho gravado pela cadeia (mesmo código da chamada) e devolve o áudio tratado
async function renderClip(clip, level) {
  const sr = clip.sr;
  let input = clip.raw, used = level;
  let autoKind = null;
  if (level === 'auto') { autoKind = autoPick(analyzeClip(clip.raw, sr)); }
  const ctx = new OfflineAudioContext(1, input.length, sr);
  const buf = ctx.createBuffer(1, input.length, sr); buf.copyToChannel(input, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const chain = await buildVoiceChain(ctx, src, { level: level === 'auto' ? 'auto' : level, offline: true, autoStart: autoKind, gate: prefs.gate });
  chain.ptt.connect(ctx.destination);
  src.start();
  await new Promise(r => setTimeout(r, 400));     // o modelo termina de carregar dentro do worklet
  const out = await ctx.startRendering();
  // tira os 20 ms de antecipação para os dois ficarem alinhados
  const y = out.getChannelData(0), shift = Math.round(sr * 0.02);
  const al = new Float32Array(y.length); al.set(y.subarray(shift));
  return { y: al, used, autoKind };
}
