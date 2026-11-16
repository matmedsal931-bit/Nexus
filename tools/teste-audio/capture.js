// Grava o que sai do "microfone" do Chrome alimentado por um arquivo (microfone falso).
// uso: node capture.js <cenario> <modo> [url]
//   modo 'browser-ns' / 'browser-raw' : só o getUserMedia com/sem a supressão nativa do Chrome
//   modo 'app:<nivel>' : abre o Nexo e grava a saída da cadeia do app (acquireMic) no nível dado
const puppeteer = require('/home/claude/e2e/node_modules/puppeteer-core');
const fs = require('fs');
const [, , scen, mode, url = 'http://localhost:3999'] = process.argv;
const writeWav = (file, i16) => {
  const buf = Buffer.from(i16.buffer), n = buf.length, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
  fs.writeFileSync(file, Buffer.concat([h, buf]));
};
(async () => {
  const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=/home/claude/audiotest/wav/${scen}.wav`, '--autoplay-policy=no-user-gesture-required'] });
  const p = await br.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  let setup;
  if (mode.startsWith('app:')) {
    await p.goto(url); await p.waitForSelector('#auth-form');
    await p.click('.tab[data-mode=register]'); await p.type('#auth-user', 'cap_' + Math.random().toString(36).slice(2, 8)); await p.type('#auth-pass', 'senha123'); await p.click('#auth-submit'); await p.waitForSelector('#app:not(.hidden)');
    await p.evaluate(lvl => { const [ns, gate, ...fl] = lvl.split('+'); setPref('ns', ns); setPref('gate', gate || 'off'); setPref('agc', !fl.includes('noagc')); setPref('comp', !fl.includes('nocomp')); setPref('hpf', !fl.includes('nohpf')); }, mode.slice(4));
    setup = `const t = await acquireMic(); window.__trk = t; const ctx = call.audioCtx; const stream = new MediaStream([t]);`;
  } else {
    await p.goto(url + '/health');
    setup = `const ctx = new AudioContext({ sampleRate: 48000 }); const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: ${mode === "browser-ns"}, echoCancellation: false, autoGainControl: false } });`;
  }
  const b64 = await p.evaluate(new Function(`return (async () => {
    ${setup}
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const code = "class R extends AudioWorkletProcessor{constructor(){super();this.on=true}process(i){if(i[0]&&i[0][0])this.port.postMessage(i[0][0].slice(0));return true}}registerProcessor('rec-x',R)";
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const rec = new AudioWorkletNode(ctx, 'rec-x');
    const chunks = [];
    rec.port.onmessage = e => chunks.push(e.data);
    src.connect(rec);
    const mute = ctx.createGain(); mute.gain.value = 0; rec.connect(mute).connect(ctx.destination);
    await new Promise(r => setTimeout(r, 26500));
    const n = chunks.reduce((a, c) => a + c.length, 0), y = new Int16Array(n);
    let o = 0; for (const c of chunks) { for (let i = 0; i < c.length; i++) y[o + i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); o += c.length; }
    let s = ''; const u8 = new Uint8Array(y.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  })()`));
  const i16 = new Int16Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer);
  fs.mkdirSync('/home/claude/audiotest/cap', { recursive: true });
  writeWav(`/home/claude/audiotest/cap/${scen}__${mode.replace(/[:+]/g, '_')}.wav`, i16);
  await br.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
