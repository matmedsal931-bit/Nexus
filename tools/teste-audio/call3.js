const puppeteer = require('/home/claude/e2e/node_modules/puppeteer-core'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const fs = require('fs');
const URL = 'http://localhost:3999';
const launch = file => puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(file ? [`--use-file-for-fake-audio-capture=/home/claude/audiotest/wav/${file}.wav`] : [])] });
const reg = async (p, user, url = URL) => { await p.goto(url); await p.waitForSelector('#auth-form'); await p.click('.tab[data-mode=register]'); await p.type('#auth-user', user); await p.type('#auth-pass', 'senha123'); await p.click('#auth-submit'); await p.waitForSelector('#app:not(.hidden)'); await sleep(700); };
const wav = (file, i16) => { const buf = Buffer.from(i16.buffer), n = buf.length, h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40); fs.writeFileSync(file, Buffer.concat([h, buf])); };
(async () => {
  const bA = await launch('ventilador'), bB = await launch('teclado'), bC = await launch(null);
  const A = await bA.newPage(), B = await bB.newPage(), C = await bC.newPage();
  for (const p of [A, B, C]) await p.setViewport({ width: 1440, height: 900 });
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) p.on('pageerror', e => console.log(n, 'PAGEERROR', e.message));
  await reg(A, 'pessoa_a');
  await A.click('.g-btn.add'); await A.type('#m-gname', 'Teste'); await A.click('#m-create button'); await sleep(600);
  const inv = await A.evaluate(() => S.groups[0].invite);
  await reg(B, 'pessoa_b', URL + '/?convite=' + inv); await reg(C, 'pessoa_c', URL + '/?convite=' + inv);
  await A.evaluate(() => setPref('ns', 'auto')); await B.evaluate(() => setPref('ns', 'med')); await C.evaluate(() => setPref('ns', 'high'));
  const vc = await A.evaluate(() => S.groups[0].channels.find(c => c.type === 'voice').id);
  for (const p of [A, B, C]) { await p.evaluate(v => joinCall(v), vc); await sleep(1500); }
  await sleep(4000);
  console.log('A, B, C cada um com o próprio supressor:', JSON.stringify(await Promise.all([A, B, C].map(p => p.evaluate(() => [call.micTrack?._ns, call.micTrack?._chain?.kind])))));
  console.log('codec de áudio negociado (A→C):', await A.evaluate(async () => { const pc = [...call.peers.values()][0].pc; const st = await pc.getStats(); let m = ''; st.forEach(r => { if (r.type === 'codec' && /audio/.test(r.mimeType)) m += r.mimeType + ' '; }); return m; }));
  // C grava o que recebe de A e de B
  const got = await C.evaluate(async () => {
    const ctx = call.audioCtx;
    const code = "class R2 extends AudioWorkletProcessor{process(i){const a=i[0]&&i[0][0];if(a)this.port.postMessage(a.slice(0));return true}}registerProcessor('rec-c',R2)";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const out = {};
    const jobs = [...call.peers.values()].map(peer => {
      const src = ctx.createMediaStreamSource(peer.micAudio.srcObject), rec = new AudioWorkletNode(ctx, 'rec-c'), m = ctx.createGain(); m.gain.value = 0;
      src.connect(rec).connect(m).connect(ctx.destination);
      const parts = []; rec.port.onmessage = e => parts.push(e.data);
      out[peer.username] = parts;
    });
    await new Promise(r => setTimeout(r, 27000));
    const res = {};
    for (const [k, parts] of Object.entries(out)) {
      const n = parts.reduce((s, p) => s + p.length, 0), y = new Int16Array(n); let o = 0;
      for (const p of parts) { for (let i = 0; i < p.length; i++) y[o + i] = Math.max(-32768, Math.min(32767, Math.round(p[i] * 32767))); o += p.length; }
      let s = ''; const u8 = new Uint8Array(y.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      res[k] = btoa(s);
    }
    return res;
  });
  for (const [who, b64] of Object.entries(got)) {
    const scen = who === 'pessoa_a' ? 'ventilador' : 'teclado';
    wav(`/home/claude/audiotest/cap/${scen}__recebido_por_C_de_${who}.wav`, new Int16Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer));
  }
  console.log('C ouve A pelo elemento de áudio sem filtro extra:', await C.evaluate(() => [...call.peers.values()].map(p => p.username + ': ' + (p.micAudio.srcObject.getAudioTracks()[0]?.label || 'faixa remota')).join(' | ')));
  await Promise.all([bA.close(), bB.close(), bC.close()]);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
