/**
 * StreamBridge — main.js
 * Processo principal Electron
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path   = require('path');
const http   = require('http');
const fs     = require('fs');
const { WebSocketServer, WebSocket } = require('ws');
const os     = require('os');

// ─── Prevent multiple instances ───────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow  = null;
let tray        = null;
let httpServer  = null;
let wss         = null;
let serverPort  = 4000;
let serverRunning = false;
let lt          = null;   // localtunnel instance
let tunnelUrl   = null;

// ─── Get local IP ─────────────────────────────────────────────────────────────
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

// ─── Signaling Server ─────────────────────────────────────────────────────────
function startSignalingServer(port) {
  return new Promise((resolve, reject) => {
    // Serve client.html
    httpServer = http.createServer((req, res) => {
      let urlPath = req.url.split('?')[0];

      // Tunnel status endpoint — used by client.html to get the HTTPS tunnel URL
      if (urlPath === '/tunnel') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ url: tunnelUrl || null }));
        return;
      }

      if (urlPath === '/' || urlPath === '') urlPath = '/client.html';
      const filePath = path.join(__dirname, urlPath);

      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext  = path.extname(filePath);
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
        res.end(data);
      });
    });

    wss = new WebSocketServer({ server: httpServer });
    const rooms = new Map();

    wss.on('connection', (ws) => {
      ws.peerId = generateId();
      ws.roomId = null;

      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {
          case 'join': {
            const roomId = String(msg.room || 'default').slice(0, 32);
            ws.roomId = roomId;
            ws.role   = msg.role || 'viewer';
            if (!rooms.has(roomId)) rooms.set(roomId, new Set());
            const room = rooms.get(roomId);
            room.add(ws);

            const peers = [...room].filter(c => c !== ws).map(c => ({ id: c.peerId, role: c.role }));
            ws.send(JSON.stringify({ type: 'joined', peerId: ws.peerId, room: roomId, peers }));
            broadcastRoom(rooms, roomId, { type: 'peer-joined', peerId: ws.peerId, role: ws.role }, ws);

            // Notify renderer
            if (mainWindow) {
              mainWindow.webContents.send('peer-update', getRoomStats(rooms));
            }
            break;
          }
          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            relayTo(rooms, ws.roomId, msg.to, { ...msg, from: ws.peerId });
            break;
          }
          case 'broadcast': {
            broadcastRoom(rooms, ws.roomId, { ...msg, from: ws.peerId }, ws);
            break;
          }
        }
      });

      ws.on('close', () => {
        if (ws.roomId && rooms.has(ws.roomId)) {
          const room = rooms.get(ws.roomId);
          room.delete(ws);
          if (room.size === 0) rooms.delete(ws.roomId);
          else broadcastRoom(rooms, ws.roomId, { type: 'peer-left', peerId: ws.peerId });
          if (mainWindow) mainWindow.webContents.send('peer-update', getRoomStats(rooms));
        }
      });

      ws.on('error', () => {});
    });

    httpServer.listen(port, '0.0.0.0', () => {
      serverRunning = true;
      serverPort    = port;
      resolve(port);
    });

    httpServer.on('error', reject);
  });
}

function stopSignalingServer() {
  return new Promise((res) => {
    if (wss)  wss.close(() => {});
    if (httpServer) httpServer.close(() => { serverRunning = false; res(); });
    else res();
  });
}

// ─── Tunnel (Cloudflare Quick Tunnel — sem senha, sem conta) ──────────────────
async function startTunnel(port) {
  await stopTunnel();
  let cfTunnel;
  try { cfTunnel = require('cloudflared'); }
  catch { throw new Error('cloudflared não instalado. Execute: npm install'); }

  // Ensure binary is downloaded (no-op if already present)
  try { await cfTunnel.install(cfTunnel.bin); } catch {}

  const { url, child, stop: cfStop } = await cfTunnel.tunnel({ '--url': `http://localhost:${port}` });
  lt = { stop: cfStop, child };
  // url is a Promise<string> that resolves once the tunnel is established
  tunnelUrl = await url;

  child.on('exit', () => {
    tunnelUrl = null; lt = null;
    if (mainWindow) mainWindow.webContents.send('tunnel-update', { url: null });
  });

  return tunnelUrl;
}

function stopTunnel() {
  return new Promise(res => {
    if (lt) {
      try { lt.stop(); } catch {}
      lt = null; tunnelUrl = null;
    }
    res();
  });
}

function broadcastRoom(rooms, roomId, data, exclude = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function relayTo(rooms, roomId, targetId, data) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const client of room) {
    if (client.peerId === targetId && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

function getRoomStats(rooms) {
  const stats = {};
  for (const [id, members] of rooms) stats[id] = members.size;
  return stats;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

// ─── Create Window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  900,
    height: 620,
    minWidth:  800,
    minHeight: 560,
    frame: false,            // custom title bar
    transparent: false,
    backgroundColor: '#080810',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile('app.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  // fallback: use a blank 16x16 if icon doesn't exist
  let icon;
  try { icon = nativeImage.createFromPath(iconPath); }
  catch { icon = nativeImage.createEmpty(); }

  tray = new Tray(icon);
  tray.setToolTip('StreamBridge');

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir StreamBridge', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuiting = true; app.quit(); } },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('server:start', async (_, port) => {
  if (serverRunning) await stopSignalingServer();
  try {
    const p = await startSignalingServer(port || 4000);
    return { ok: true, port: p, ip: getLocalIP() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('server:stop', async () => {
  await stopSignalingServer();
  return { ok: true };
});

ipcMain.handle('server:status', () => ({
  running: serverRunning,
  port:    serverPort,
  ip:      getLocalIP(),
}));

ipcMain.handle('open:browser', (_, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get:ip', () => getLocalIP());

ipcMain.handle('tunnel:start', async () => {
  try {
    const url = await startTunnel(serverPort || 4000);
    if (mainWindow) mainWindow.webContents.send('tunnel-update', { url });
    return { ok: true, url };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('tunnel:stop', async () => {
  await stopTunnel();
  if (mainWindow) mainWindow.webContents.send('tunnel-update', { url: null });
  return { ok: true };
});

ipcMain.handle('tunnel:status', () => ({ url: tunnelUrl }));

// Window controls
ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('win:close', () => mainWindow?.hide());
ipcMain.on('win:quit',  () => { app.isQuiting = true; app.quit(); });

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Auto-start server on port 4000
  try { await startSignalingServer(4000); } catch {}
});

app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows/Linux
  if (process.platform === 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', async () => {
  app.isQuiting = true;
  await stopTunnel();
  await stopSignalingServer();
});
