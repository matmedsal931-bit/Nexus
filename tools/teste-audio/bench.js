// Disputa: nenhum x Speex x RNNoise x GTCRN em todos os cenários (no Chrome, offline)
const puppeteer = require('/home/claude/e2e/node_modules/puppeteer-core');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8077'], { cwd: '/home/claude', stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await br.newPage();
  p.on('console', m => m.type() === 'error' && console.log('err', m.text()));
  await p.goto('http://localhost:8077/audiotest/bench.html');
  const scen = process.argv[2] ? process.argv[2].split(',') : ['ventilador', 'teclado', 'mouse', 'computador', 'ar_condicionado', 'vento', 'ambiente', 'conversa_fundo', 'voz_baixa', 'voz_alta', 'silencio_limpo'];
  const methods = ['none', 'speex', 'rnnoise', 'gtcrn'];
  fs.mkdirSync('/home/claude/audiotest/out', { recursive: true });
  const speed = {};
  for (const s of scen) for (const m of methods) {
    const r = await p.evaluate((s, m) => run(s, m), s, m);
    const buf = Buffer.from(r.b64, 'base64');
    // grava WAV 16 bits
    const h = Buffer.alloc(44); const n = buf.length;
    h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
    fs.writeFileSync(`/home/claude/audiotest/out/${s}__${m}.wav`, Buffer.concat([h, buf]));
    (speed[m] ||= []).push(r.secs * 1000 / r.ms);
  }
  for (const m of methods) console.log(`velocidade ${m}: ${(speed[m].reduce((a, b) => a + b) / speed[m].length).toFixed(0)}x tempo real`);
  await br.close(); srv.kill();
})();
