# Avalia gravações do microfone falso (o arquivo de 12 s repete; acha o ponto de início e corta um ciclo inteiro)
import sys, glob, os, numpy as np, soundfile as sf
from scipy.signal import correlate
from metrics import evaluate
SR = 48000
mask = np.load('wav/fala_mask.npy')
N = len(mask)

def cut_cycle(y, ref):
    # pula os 2 primeiros segundos (o processamento se adapta) e acha onde o ciclo começa
    y = y[2 * SR:]
    L = min(len(y), 2 * N)
    c = correlate(y[:L], ref, mode='valid', method='fft')
    k = int(np.argmax(c))
    seg = y[k: k + N]
    if len(seg) < N: seg = np.concatenate([seg, np.zeros(N - len(seg))])
    return seg

def score(path):
    base = os.path.basename(path)[:-4]
    scen, mode = base.split('__')
    ref, _ = sf.read(f'wav/{scen}_ref.wav')
    y, _ = sf.read(path)
    seg = cut_cycle(y, ref)
    return scen, mode, evaluate(seg, ref, mask)

if __name__ == '__main__':
    rows = {}
    for f in sorted(glob.glob('cap/*.wav')):
        if len(sys.argv) > 1 and not any(s in f for s in sys.argv[1].split(',')): continue
        scen, mode, r = score(f)
        rows.setdefault(mode, {})[scen] = r
    for mode, d in rows.items():
        print(f'== {mode}')
        for s, r in d.items():
            print(f"  {s:16} PESQ {r['pesq']:.2f}  STOI {r['stoi']:.2f}  pausas {r['ruido_pausas']:.0f} dB  voz {r['voz_db']:+.1f} dB")
        k = [r for s, r in d.items() if s not in ('voz_baixa', 'voz_alta', 'silencio_limpo')]
        if k: print(f"  MÉDIA ruídos     PESQ {np.nanmean([r['pesq'] for r in k]):.2f}  STOI {np.mean([r['stoi'] for r in k]):.3f}  pausas {np.mean([r['ruido_pausas'] for r in k]):.0f} dB  voz {np.mean([r['voz_db'] for r in k]):+.1f} dB")
