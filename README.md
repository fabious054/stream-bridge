# StreamBridge — App Desktop

Aplicativo desktop para compartilhamento P2P de áudio/vídeo entre dois computadores,
com integração direta ao OBS Studio via Browser Source.

---

## Instalação e uso rápido

### 1. Instalar dependências

```bash
npm install
```

### 2. Rodar o app (modo desenvolvimento)

```bash
npm start
```

O app abre com o servidor já iniciado automaticamente.

### 3. Gerar instalador (opcional)

```bash
# Windows (.exe installer)
npm run build:win

# Linux (AppImage)
npm run build:linux

# macOS (.dmg)
npm run build:mac
```

O instalador gerado fica na pasta `dist/`.

---

## Estrutura do projeto

```
streambridge/
├── main.js          ← Processo principal Electron (janela + servidor)
├── preload.js       ← Bridge segura Node ↔ UI
├── app.html         ← Interface do painel de controle
├── client.html      ← Página WebRTC (broadcaster/viewer/OBS)
├── assets/
│   ├── icon.png     ← Ícone do app (256×256)
│   └── tray.png     ← Ícone da bandeja do sistema (16×16)
└── package.json
```

---

## Como usar

### No PC que transmite (Broadcaster):
1. Abra o StreamBridge
2. O servidor inicia automaticamente
3. Clique em **Broadcaster** na tela inicial
4. O navegador abre com a câmera/mic já configurados

### No PC do OBS (Receiver):
1. Copie a URL OBS mostrada no app do outro PC (ex: `http://192.168.1.x:4000/?obs=1&room=minha-sala`)
2. No OBS: Fontes → + → Browser Source
3. Cole a URL, defina 1920×1080, marque "Controlar áudio via OBS"
4. Clique OK — o stream aparece automaticamente

---

## Qualidade disponível

| Modo   | Resolução  | FPS | Bitrate  |
|--------|------------|-----|----------|
| 480p   | 854×480    | 30  | 1 Mbps   |
| 720p   | 1280×720   | 30  | 2.5 Mbps |
| 1080p  | 1920×1080  | 60  | 8 Mbps   |
| Tela   | 1920×1080  | 60  | 8 Mbps   |

---

## Para usar via Internet (fora da rede local)

Adicione um TURN server nas Configurações do app. Você pode usar:
- https://www.metered.ca/tools/openrelay/ (gratuito para teste)
- Seu próprio coturn server

---

## Tecnologias

- **Electron** — app desktop multiplataforma
- **WebRTC** — P2P de áudio/vídeo (VP8/VP9 + Opus)
- **WebSocket** — sinalização para handshake
- **Node.js http** — serve o client.html integrado
