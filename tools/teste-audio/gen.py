# Gera os cenários de teste: voz limpa + ruído, com a referência limpa ao lado.
# Tudo em 48 kHz mono, 16 bits (o formato que o Chrome aceita como "microfone falso").
import subprocess, numpy as np, soundfile as sf, os
from scipy.signal import butter, sosfilt, resample_poly

SR = 48000
OUT = os.path.dirname(os.path.abspath(__file__)) + '/wav'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def tts(text, voice='pt-br', speed=150, pitch=50):
    raw = subprocess.run(['espeak-ng', '-v', voice, '-s', str(speed), '-p', str(pitch), '--stdout', text], capture_output=True).stdout
    open('/tmp/_t.wav', 'wb').write(raw)
    x, sr = sf.read('/tmp/_t.wav')
    return resample_poly(x, SR, sr)

def db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
def set_db(x, target): return x * 10 ** ((target - db(x)) / 20)
def band(x, lo=None, hi=None, order=4):
    if lo and hi: sos = butter(order, [lo, hi], 'bandpass', fs=SR, output='sos')
    elif lo: sos = butter(order, lo, 'highpass', fs=SR, output='sos')
    else: sos = butter(order, hi, 'lowpass', fs=SR, output='sos')
    return sosfilt(sos, x)

DUR = 12.0
N = int(SR * DUR)

# voz: 3 frases com pausas (as pausas medem quanto ruído sobra quando ninguém fala)
frases = ['Oi pessoal, vamos começar a partida agora.', 'Eu vou pelo lado esquerdo, me cubram.', 'Boa! Ganhamos essa rodada, bora de novo.']
voz = np.zeros(N)
pos = int(0.8 * SR)
marks = []
for f in frases:
    s = tts(f)
    s = set_db(s, -20)
    voz[pos:pos + len(s)] += s[:N - pos]
    marks.append((pos, pos + len(s)))
    pos += len(s) + int(1.1 * SR)
fala = np.zeros(N, bool)
for a, b in marks: fala[a:b] = True

def pink(n):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w); k = np.arange(len(f)); k[0] = 1
    return np.fft.irfft(f / np.sqrt(k), n)
def brown(n):
    return band(np.cumsum(rng.standard_normal(n)), lo=20)

t = np.arange(N) / SR
def clicks(rate, lo, hi, dur_ms, n):
    x = np.zeros(n)
    tt = 0.3
    while tt < DUR - 0.1:
        i = int(tt * SR); L = int(dur_ms / 1000 * SR)
        burst = rng.standard_normal(L) * np.exp(-np.linspace(0, 8, L))
        x[i:i + L] += burst * rng.uniform(0.6, 1.0)
        tt += rng.exponential(1 / rate)
    return band(x, lo, hi)

ruidos = {
    'ventilador': lambda: band(brown(N) * 0.6 + pink(N) * 0.4, 30, 4000) + 0.3 * set_db(np.sin(2 * np.pi * 118 * t) + 0.5 * np.sin(2 * np.pi * 236 * t), -40),
    'teclado': lambda: clicks(9, 1500, 9000, 12, N),
    'mouse': lambda: clicks(2.5, 2000, 12000, 6, N),
    'computador': lambda: band(pink(N), 60, 6000) + set_db(np.sin(2 * np.pi * 7900 * t), -46),
    'ar_condicionado': lambda: band(pink(N), 100, 8000) + set_db(np.sin(2 * np.pi * 60 * t) + 0.6 * np.sin(2 * np.pi * 120 * t), -38),
    'vento': lambda: band(brown(N), 20, 400) * (1 + 0.8 * np.sin(2 * np.pi * 0.7 * t + rng.uniform(0, 6))),
    'ambiente': lambda: band(pink(N), 80, 10000),
}
# conversa ao fundo: outras vozes mais baixas e abafadas
def conversa():
    x = np.zeros(N)
    for i, (txt, pit) in enumerate([('o jogo de ontem foi muito bom, você viu o final', 30), ('preciso comprar pão e leite antes de voltar para casa', 75)]):
        s = tts(txt, speed=170, pitch=pit)
        st = int(rng.uniform(0.1, 3) * SR)
        x[st:st + len(s)] += s[:N - st]
        s2 = tts(txt + ' e depois a gente conversa melhor', speed=160, pitch=pit)
        st2 = st + len(s) + int(0.4 * SR)
        if st2 < N: x[st2:st2 + len(s2)] += s2[:N - st2]
    return band(x, 150, 4000)
ruidos['conversa_fundo'] = conversa

NIVEL = {'ventilador': -38, 'teclado': -34, 'mouse': -36, 'computador': -42, 'ar_condicionado': -40, 'vento': -34, 'ambiente': -42, 'conversa_fundo': -36}
cenarios = {}
for nome, fn in ruidos.items():
    cenarios[nome] = (voz, set_db(fn(), NIVEL[nome]))
# voz baixa e alta (com ruído ambiente leve)
amb = set_db(band(pink(N), 80, 10000), -50)
cenarios['voz_baixa'] = (set_db(voz, db(voz) - 14), amb)
cenarios['voz_alta'] = (set_db(voz, db(voz) + 8), amb)
cenarios['silencio_limpo'] = (voz, np.zeros(N))

for nome, (v, r) in cenarios.items():
    mix = v + r
    peak = np.max(np.abs(mix))
    g = 0.95 / peak if peak > 0.95 else 1
    sf.write(f'{OUT}/{nome}.wav', (mix * g).astype(np.float32), SR, subtype='PCM_16')
    sf.write(f'{OUT}/{nome}_ref.wav', (v * g).astype(np.float32), SR, subtype='PCM_16')
np.save(f'{OUT}/fala_mask.npy', fala)
print('cenários:', ', '.join(cenarios), '| fala', round(fala.mean() * 100), '% do tempo')
