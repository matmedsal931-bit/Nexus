// ---------------------------------------------------------------------
// Sons do Nexo — todos sintetizados na hora (sem arquivos para baixar).
// Cada ação tem o seu som, para dar para saber o que aconteceu sem olhar.
// ---------------------------------------------------------------------
const SFX = (() => {
  let bus = null;
  // Saída comum com compressor: deixa o toque alto sem estourar
  function out() {
    ensureAudioCtx();
    const ctx = call.audioCtx;
    if (!ctx) return null;
    if (!bus || bus.ctx !== ctx) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.15;
      const master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      bus = { ctx, master };
    }
    bus.master.gain.value = Math.max(0, Math.min(1, (prefs.sfxVol ?? 80) / 100));
    return bus;
  }
  // Uma nota: timbre = 'sine' | 'triangle' | 'square' | 'bell'
  function note(b, { f, f2, at = 0, dur = 0.16, vol = 0.2, type = 'sine', attack = 0.008 }) {
    const ctx = b.ctx, t0 = ctx.currentTime + 0.01 + at;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(b.master);
    const voices = type === 'bell' ? [[1, 1, 'sine'], [2, 0.35, 'sine'], [3.01, 0.12, 'sine']] : [[1, 1, type]];
    const nodes = [];
    for (const [mul, amp, wave] of voices) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = wave;
      o.frequency.setValueAtTime(f * mul, t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2 * mul, t0 + dur * 0.8);
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t0); o.stop(t0 + dur + 0.05);
      nodes.push(o);
    }
    return nodes;
  }
  const N = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G4: 392, A4: 440, E4: 329.63, C4: 261.63 };

  const sounds = {
    // eu entrei / saí da chamada
    join: b => [N.C5, N.E5, N.G5].forEach((f, i) => note(b, { f, at: i * 0.07, dur: 0.22, vol: 0.16, type: 'bell' })),
    leave: b => [N.G5, N.E5, N.C5].forEach((f, i) => note(b, { f, at: i * 0.08, dur: 0.24, vol: 0.16, type: 'bell' })),
    // outra pessoa entrou / saiu
    peerJoin: b => { note(b, { f: N.E5, dur: 0.14, vol: 0.12, type: 'triangle' }); note(b, { f: N.A5, at: 0.08, dur: 0.18, vol: 0.12, type: 'triangle' }); },
    peerLeave: b => { note(b, { f: N.A5, dur: 0.14, vol: 0.12, type: 'triangle' }); note(b, { f: N.E5, at: 0.08, dur: 0.2, vol: 0.12, type: 'triangle' }); },
    // microfone (só quem mutou ouve)
    mute: b => note(b, { f: 520, f2: 300, dur: 0.14, vol: 0.18, type: 'triangle' }),
    unmute: b => note(b, { f: 330, f2: 640, dur: 0.14, vol: 0.18, type: 'triangle' }),
    // áudio (fone)
    deafen: b => { note(b, { f: 560, dur: 0.1, vol: 0.16, type: 'triangle' }); note(b, { f: 370, at: 0.09, dur: 0.16, vol: 0.16, type: 'triangle' }); },
    undeafen: b => { note(b, { f: 370, dur: 0.1, vol: 0.16, type: 'triangle' }); note(b, { f: 560, at: 0.09, dur: 0.16, vol: 0.16, type: 'triangle' }); },
    // um moderador silenciou alguém (a sala toda ouve)
    modMute: b => { note(b, { f: 300, dur: 0.12, vol: 0.13, type: 'square' }); note(b, { f: 200, at: 0.11, dur: 0.2, vol: 0.13, type: 'square' }); },
    modUnmute: b => { note(b, { f: 200, dur: 0.12, vol: 0.13, type: 'square' }); note(b, { f: 300, at: 0.11, dur: 0.2, vol: 0.13, type: 'square' }); },
    // alguém começou a transmitir
    live: b => [N.G5, N.C6].forEach((f, i) => note(b, { f, at: i * 0.1, dur: 0.3, vol: 0.12, type: 'bell' })),
    // ligação recusada / ocupado
    busy: b => [0, 0.32, 0.64].forEach(at => note(b, { f: 425, at, dur: 0.22, vol: 0.14, type: 'sine', attack: 0.01 })),
  };

  // Toque de quem RECEBE a ligação: melodia alta e repetida, para chamar atenção
  const RING = [[N.E5, 0], [N.G5, 0.14], [N.C6, 0.28], [N.E6, 0.42], [N.C6, 0.62], [N.G5, 0.76], [N.C6, 0.9], [N.E6, 1.04], [N.G5, 1.36], [N.C6, 1.5]];
  // Toque de quem LIGA (chamando…): "tuuu" de telefone, mais baixo
  let loop = null;
  function stopLoop() { if (loop) { clearInterval(loop.timer); loop.nodes.forEach(o => { try { o.stop(); } catch {} }); loop = null; } }
  function startLoop(kind) {
    stopLoop();
    const b = out(); if (!b) return;
    const nodes = [];
    const play = () => {
      const bb = out(); if (!bb) return;
      if (kind === 'ring') for (const [f, at] of RING) nodes.push(...note(bb, { f, at, dur: 0.3, vol: 0.42, type: 'bell', attack: 0.004 }));
      else { nodes.push(...note(bb, { f: 425, dur: 1.1, vol: 0.09, type: 'sine', attack: 0.03 })); nodes.push(...note(bb, { f: 480, dur: 1.1, vol: 0.05, type: 'sine', attack: 0.03 })); }
      if (nodes.length > 80) nodes.splice(0, nodes.length - 40);
    };
    play();
    loop = { kind, nodes, timer: setInterval(play, kind === 'ring' ? 2300 : 3500) };
  }

  return {
    play(name) {
      if (prefs.sfx === false) return;
      try { const b = out(); if (b && sounds[name]) sounds[name](b); } catch (e) { console.warn('som', e); }
    },
    ring() { try { startLoop('ring'); } catch {} },
    ringback() { try { startLoop('back'); } catch {} },
    stop(kind) { if (!kind || loop?.kind === kind) stopLoop(); },
    get ringing() { return loop?.kind === 'ring'; },
    get calling() { return loop?.kind === 'back'; },
  };
})();
