# Nexo 💬🎥

App de grupos estilo Discord, para **PC e celular**:

- Contas com login e senha
- **Grupos** com link de convite
- **Canais de texto** com chat em tempo real e histórico salvo
- **Salas de voz** com **chamada de vídeo** (câmera frontal/traseira no celular)
- **Transmissão de tela em Full HD** (1080p 30fps ou 60fps, com áudio do PC)
- **Ligação privada** dentro da conversa: voz, vídeo e transmissão de tela, com toque de chamada, atender/recusar e aviso de "ocupado"
- **Tela de carregamento própria** com a logo do Nexo, no lugar da página do Render, quando o servidor está acordando
- **Amigos:** pedido por nome de usuário ou por ID, pendentes, aceitar/recusar, lista com quem está online
- **Na chamada:** volume de cada pessoa separado (voz e transmissão, até 200%), e **cada um escolhe a resolução que recebe** da live sem mexer na dos outros
- **Moderação de voz:** silenciar para todos, desconectar da chamada e mover de sala — por cargo ou como administrador
- **Vários aparelhos na mesma conta** na mesma chamada: aparece um perfil só, mas dá para transmitir a tela dos dois ao mesmo tempo
- **Arrastar:** mover canais entre categorias e mover pessoas entre salas de voz (só com permissão)
- **Mensagens diretas** (conversa privada), com lista de conversas e busca de pessoas
- **Enviar fotos e arquivos** (até 8 MB): arraste, cole ou use o botão +; imagens aparecem na conversa
- **Perfil:** nome exibido editável separado do @login, foto, cores, "sobre mim" e status (Disponível, Ausente, Não perturbar, Invisível)
- **Mensagens:** reagir com emoji, responder, editar, copiar e excluir (botão direito no PC, segurar o dedo no celular)
- **Configurações do grupo** (clique no nome do grupo): perfil do grupo (nome, ícone, faixa, descrição), mensagens de boas-vindas, emojis personalizados, membros, **cargos com permissões**, convites, banimentos e registro de auditoria
- **Categorias** de canais, expulsar e banir membros
- **Lista de membros** com quem está online, offline, em voz ou transmitindo
- Transmissão com escolha de **resolução (480p, 720p, 1080p, 1440p)** e **FPS (60, 30, 15)**
- Instalável como aplicativo (PWA) no PC e no celular, com botão "Instalar" dentro do app

## 🤖 App para Android (APK)
O arquivo `public/nexo.apk` é o app Android (versão 1.3). Depois de publicar, ele fica disponível em
`https://SEU-LINK.onrender.com/nexo.apk`. Abra esse endereço no celular, baixe e instale
(o Android pede para permitir a instalação de "fontes desconhecidas").

- A chamada **não cai** quando você sai do app ou apaga a tela: aparece uma notificação enquanto estiver conectado.
- O app permite **transmitir a tela do celular** (o navegador não permite).
- O app carrega o site, então **atualiza sozinho** a cada abertura. Só é preciso baixar um
  APK novo quando a parte nativa mudar; nesse caso o próprio app avisa.
- O áudio dos jogos/apps do celular não é transmitido, só a imagem (e o seu microfone).
- iPhone não aceita APK; nele o Nexo funciona pelo Safari, sem transmitir a tela.

## ⏱️ Evitar a demora da primeira abertura
No plano grátis, o Render desliga o servidor depois de 15 minutos sem ninguém usando, e a próxima
abertura leva quase um minuto. O Nexo já mostra a **sua tela de carregamento** nesse tempo (logo + animação),
mas dá para quase eliminar a espera:

1. No GitHub, abra a aba **Actions** e clique em **I understand my workflows, go ahead and enable them**.
2. O arquivo `.github/workflows/manter-acordado.yml` já vai no projeto: ele acessa o site a cada 10 minutos.
3. Abra o arquivo e troque a URL pela do seu site, se for diferente.

Observação: o GitHub pausa esse agendamento se o repositório ficar 60 dias sem nenhuma alteração —
basta rodar **Run workflow** na mão para religar.

## 🔄 Como atualizar o app que já está no ar
1. Abra o seu repositório no GitHub.
2. Clique em **Add file** e depois em **Upload files**.
3. Arraste de novo todo o conteúdo da pasta `nexo` (os arquivos novos substituem os antigos).
4. Clique em **Commit changes**. O Render atualiza o app sozinho em 1 a 2 minutos.

---

## 🚀 Hospedar de graça (sem usar o seu PC)

Você vai usar 3 serviços gratuitos:

| Serviço | Para quê |
|---|---|
| **GitHub** | guardar o código |
| **Render** | rodar o servidor 24h, com HTTPS |
| **Neon** | banco de dados, para as contas e mensagens não sumirem |

### Passo 1: banco de dados (Neon), 2 minutos
1. Entre em **https://neon.tech** e crie uma conta (pode usar a do Google).
2. Crie um projeto (qualquer nome, região **São Paulo** se houver).
3. Copie a **Connection string**. Ela começa com `postgresql://...`
   Guarde esse texto, você vai usar no passo 3.

### Passo 2: subir o código no GitHub, 3 minutos
1. Crie uma conta em **https://github.com**.
2. Clique em **New repository**, dê o nome `nexo` e clique em **Create repository**.
3. Clique em **"uploading an existing file"**.
4. Descompacte o `nexo.zip` e **arraste todo o conteúdo da pasta** (os arquivos `server.js`, `package.json`, a pasta `public`…) para a página.
5. Clique em **Commit changes**.

### Passo 3: colocar no ar (Render), 3 minutos
1. Entre em **https://render.com** e clique em **Get Started** (entre com a conta do GitHub).
2. Clique em **New +** e escolha **Blueprint**.
3. Escolha o repositório `nexo`. O Render vai ler o arquivo `render.yaml` sozinho.
4. Quando ele pedir as variáveis:
   - `DATABASE_URL`: cole a connection string do Neon
   - `TURN_URL`, `TURN_USER`, `TURN_PASS`: pode deixar vazio por enquanto (veja o passo 4)
5. Clique em **Apply**. Em uns 2 minutos o app fica no ar num endereço como:
   **`https://nexo-xxxx.onrender.com`**

Pronto! Mande esse link para os seus amigos. 🎉

### Passo 4 (recomendado): chamadas pelo 4G e em qualquer rede
Algumas redes (4G, Wi-Fi de empresa ou faculdade) bloqueiam a conexão direta
entre as pessoas. Para a chamada funcionar nesses casos, você precisa de um **servidor TURN**:

1. Crie uma conta grátis em **https://www.metered.ca/stun-turn** (o plano grátis dá alguns GB por mês).
2. No painel, crie uma credencial e copie a URL, o usuário e a senha.
3. No Render, abra o seu serviço, vá em **Environment** e preencha:
   - `TURN_URL` = `turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp`
   - `TURN_USER` = seu usuário
   - `TURN_PASS` = sua senha
4. Salve. O Render reinicia o app sozinho.

---

## 📱 Instalar como aplicativo

- **Android (Chrome):** abra o link, toque em ⋮ e depois em **Instalar app**
- **iPhone (Safari):** abra o link, toque em Compartilhar e depois em **Adicionar à Tela de Início**
- **PC (Chrome/Edge):** clique no ícone de instalar ⊕ na barra de endereço

---

## ⚠️ Limitações importantes

- **Transmitir a tela pelo celular:** os navegadores de celular (Safari do iPhone e
  a maioria dos Androids) **não permitem** transmitir a tela. Transmita pelo **PC**.
  No celular dá para **assistir** a transmissão em Full HD normalmente, e também usar
  câmera e microfone. Para transmitir pelo celular é preciso um app nativo (veja abaixo).
- **Tamanho da chamada:** cada pessoa se conecta direto com cada outra. Funciona bem
  com **até 5 ou 6 pessoas com vídeo**, ou cerca de 10 só com voz. Para salas
  maiores, use um servidor de mídia (SFU) como o **LiveKit**.
- **Plano grátis do Render:** o servidor "dorme" depois de 15 minutos sem ninguém usando.
  O primeiro acesso depois disso demora cerca de 1 minuto para carregar. O plano pago
  (US$ 7/mês) deixa o servidor sempre ligado.
- **Full HD real** depende da internet de quem transmite: 1080p 30fps usa cerca de
  6 Mbps de upload para **cada** pessoa assistindo.

---

## 💻 Rodar no seu PC (opcional, para testar ou mexer no código)

Instale o **Node.js 18+** (https://nodejs.org) e rode:

```bash
npm install
npm start
```

Abra **http://localhost:3000**.

Para testar com o celular na mesma rede Wi-Fi (o celular exige HTTPS para câmera e microfone):

```bash
npm run https
```

No celular, abra `https://IP-DO-SEU-PC:3000` e aceite o aviso de segurança.

---

## 🗂️ Estrutura

```
server.js          servidor: contas, grupos, chat e sinalização das chamadas
public/index.html  página do app
public/app.js      lógica do app: chat, chamadas e transmissão (WebRTC)
public/style.css   visual (PC e celular)
public/sw.js       permite instalar como aplicativo
render.yaml        configuração de hospedagem no Render
```

## 🔜 Próximos passos possíveis
- Envio de imagens e arquivos
- Mensagens diretas (DM)
- Cargos e permissões
- App nativo para as lojas (Capacitor), o que também libera a transmissão de tela no Android
- LiveKit (SFU) para salas grandes
