for s in ventilador teclado mouse computador ar_condicionado vento ambiente conversa_fundo voz_baixa voz_alta silencio_limpo; do
  for m in app:off+auto app:low+auto app:med+auto app:high+auto app:auto+auto; do node capture.js $s $m & done; wait
done
