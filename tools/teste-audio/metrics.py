# Métricas objetivas de supressão de ruído
#  PESQ (1 a 4.5): qualidade percebida da voz, comparando com a voz limpa
#  STOI (0 a 1): inteligibilidade da fala
#  ruído nas pausas (dB): quanto som sobra quando a pessoa NÃO está falando (menor = melhor)
#  voz preservada (dB): diferença de volume da fala em relação à original (perto de 0 = não abafou)
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, correlate
from pesq import pesq
from pystoi import stoi

SR = 48000
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)

def align(y, ref, maxlag=4800):
    a = y[:SR * 6]; b = ref[:SR * 6]
    c = correlate(a, b, mode='full', method='fft')
    mid = len(b) - 1
    seg = c[mid - maxlag: mid + maxlag + 1]
    lag = int(np.argmax(np.abs(seg))) - maxlag
    if lag > 0: y = np.concatenate([y[lag:], np.zeros(lag)])
    elif lag < 0: y = np.concatenate([np.zeros(-lag), y[:lag]])
    return y, lag

def evaluate(proc, ref, mask):
    n = min(len(proc), len(ref), len(mask))
    proc, ref, mask = proc[:n], ref[:n], mask[:n]
    proc, lag = align(proc, ref)
    r16 = resample_poly(ref, 1, 3); p16 = resample_poly(proc, 1, 3)
    try: q = pesq(16000, r16, p16, 'wb')
    except Exception: q = float('nan')
    s = stoi(ref, proc, SR, extended=False)
    # pausas: ignora 150 ms perto da fala (cauda da voz)
    pad = int(0.15 * SR)
    m = mask.copy()
    idx = np.where(mask)[0]
    for a in [idx.min()]: pass
    dil = np.convolve(mask.astype(float), np.ones(2 * pad + 1), 'same') > 0
    pause = ~dil
    pause[: int(0.3 * SR)] = False   # início (adaptação)
    noise = rms_db(proc[pause])
    vprev = rms_db(proc[mask]) - rms_db(ref[mask])
    return dict(pesq=q, stoi=s, ruido_pausas=noise, voz_db=vprev, lag_ms=lag / 48)
