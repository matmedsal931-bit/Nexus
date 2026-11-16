import sys, numpy as np, soundfile as sf
from metrics import evaluate
mask = np.load('wav/fala_mask.npy')
scen = ['ventilador','teclado','mouse','computador','ar_condicionado','vento','ambiente','conversa_fundo','voz_baixa','voz_alta','silencio_limpo']
methods = sys.argv[1].split(',') if len(sys.argv) > 1 else ['none','speex','rnnoise','gtcrn']
tot = {m: [] for m in methods}
print(f"{'cenário':16}" + ''.join(f"{m:>30}" for m in methods))
print(' ' * 16 + ''.join(f"{'PESQ STOI pausa voz':>30}" for m in methods))
for s in scen:
    ref, _ = sf.read(f'wav/{s}_ref.wav')
    row = f'{s:16}'
    for m in methods:
        try: y, _ = sf.read(f'out/{s}__{m}.wav')
        except Exception: row += f"{'-':>30}"; continue
        r = evaluate(y, ref, mask)
        tot[m].append(r)
        row += f"{r['pesq']:>9.2f}{r['stoi']:>6.2f}{r['ruido_pausas']:>7.0f}dB{r['voz_db']:>+6.1f}"
    print(row)
print()
for m in methods:
    if not tot[m]: continue
    a = lambda k: np.nanmean([r[k] for r in tot[m][:8]])
    print(f"{m:10} média nos 8 ruídos: PESQ {a('pesq'):.2f}  STOI {a('stoi'):.3f}  ruído nas pausas {a('ruido_pausas'):.0f} dB  voz {a('voz_db'):+.1f} dB")
