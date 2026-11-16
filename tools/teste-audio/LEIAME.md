# Teste de áudio do Nexo

Mede a supressão de ruído com números, usando o próprio Chrome e o Nexo rodando.

1. `python3 gen.py` cria as vozes com ruído (precisa de `espeak-ng`, `numpy`, `scipy`, `soundfile`).
2. Com o servidor do Nexo rodando em `localhost:3999`: `bash run_all.sh` grava o que sai do microfone
   do app em cada nível (o arquivo entra como "microfone falso" do Chrome).
3. `python3 table.py` mostra PESQ (qualidade da voz, 1 a 4,5), STOI (inteligibilidade) e o ruído
   que sobra nas pausas. Precisa de `pip install pesq pystoi`.
4. `node call3.js` faz uma chamada com 3 pessoas e mede o áudio que chega do outro lado.

`resultado-v21.txt` tem a última medição.
A voz dos testes é sintetizada (espeak), então os números servem para comparar níveis entre si,
não como nota absoluta de uma voz humana.
