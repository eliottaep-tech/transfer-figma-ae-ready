const { app, BrowserWindow, Tray, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 7841;
let win;
let tray;
let QUEUE;

function writeTransfer(doc) {
  const compositionName = (doc.composition && doc.composition.name) || 'Untitled';
  const safeName = compositionName.replace(/[^\w-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.join(QUEUE, `${stamp}_${safeName}`);

  const walk = (layers) => (layers || []).forEach((l, i) => {
    if (l.image && l.image.base64) {
      const id = String(l.id || i).replace(/[^\w]/g, '_');
      const png = `${base}_${i}_${id}.png`;
      fs.writeFileSync(png, Buffer.from(l.image.base64, 'base64'));
      l.image.path = png;
      delete l.image.base64;
    }
    if (l.children) walk(l.children);
  });

  walk(doc.layers);
  const tlx = `${base}.tlx`;
  fs.writeFileSync(tlx, JSON.stringify(doc, null, 2), 'utf8');
  return tlx;
}

function startBridge() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method === 'GET' && req.url === '/health') {
      return res.end(JSON.stringify({ ok: true, version: app.getVersion() }));
    }

    if (req.method === 'POST' && req.url === '/ingest') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const doc = JSON.parse(body);
          const file = writeTransfer(doc);
          res.end(JSON.stringify({ ok: true, file }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  server.on('error', err => console.error('Bridge server error:', err));
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Transfer bridge listening on 127.0.0.1:${PORT}`);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 620,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#0f1116',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', event => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

app.whenReady().then(() => {
  QUEUE = path.join(app.getPath('userData'), 'Transfer', 'queue');
  fs.mkdirSync(QUEUE, { recursive: true });

  startBridge();
  createWindow();

  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip(`Transfer - listening on 127.0.0.1:${PORT}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Transfer', click: () => { win.show(); win.focus(); } },
    { label: 'Open transfer queue', click: () => shell.openPath(QUEUE) },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else win.show();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
