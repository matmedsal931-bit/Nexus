import glob, numpy as np
from score_cap import score
scen = ['ventilador','teclado','mouse','computador','ar_condicionado','vento','ambiente','conversa_fundo','voz_baixa','voz_alta','silencio_limpo']
modes = ['app_off_auto','app_low_auto','app_med_auto','app_high_auto','app_auto_auto']
names = {'app_off_auto':'Desativado','app_low_auto':'Baixo','app_med_auto':'Médio','app_high_auto':'Alto','app_auto_auto':'Automático'}
R = {}
for f in glob.glob('cap/*app_*_auto.wav'):
    s, m, r = score(f); R[(s, m)] = r
# original (sem nada) a partir do arquivo de entrada, para referência
import soundfile as sf
from metrics import evaluate
mask = np.load('wav/fala_mask.npy')
print(f"{'cenário':16}{'original':>18}" + ''.join(f"{names[m]:>18}" for m in modes))
print(' ' * 16 + ''.join(f"{'PESQ / pausas':>18}" for _ in range(6)))
for s in scen:
    ref, _ = sf.read(f'wav/{s}_ref.wav'); x, _ = sf.read(f'wav/{s}.wav')
    o = evaluate(x, ref, mask)
    row = f"{s:16}{o['pesq']:>9.2f} {o['ruido_pausas']:>5.0f}dB  "
    for m in modes:
        r = R.get((s, m))
        row += f"{r['pesq']:>9.2f} {r['ruido_pausas']:>5.0f}dB  " if r else f"{'-':>18}"
    print(row)
print()
for m in modes:
    k = [R[(s, m)] for s in scen[:8] if (s, m) in R]
    a = lambda key: np.nanmean([r[key] for r in k])
    vb = R.get(('voz_baixa', m)); va = R.get(('voz_alta', m)); cl = R.get(('silencio_limpo', m))
    print(f"{names[m]:11} 8 ruídos: PESQ {a('pesq'):.2f}  STOI {a('stoi'):.3f}  pausas {a('ruido_pausas'):.0f} dB | voz baixa: {vb['voz_db']:+.1f} dB (STOI {vb['stoi']:.2f}) | voz alta: {va['voz_db']:+.1f} dB (STOI {va['stoi']:.2f}) | voz limpa PESQ {cl['pesq']:.2f}")
