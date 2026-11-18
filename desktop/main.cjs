'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DRIVER_HELP = 'https://help.positivegrid.com/hc/en-us/articles/15708382773901-Installing-Windows-Driver-for-Spark-GO';
const USB_HELP = 'https://help.positivegrid.com/hc/en-us/articles/13744445585933-USB-Audio-with-Spark-GO';
const scheme = 'echolab';

protocol.registerSchemesAsPrivileged([{scheme, privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
}}]);

let mainWindow;
function appRoot() { return path.resolve(app.getAppPath(), 'out'); }
function resolvePath(url) {
  const parsed = new URL(url);
  const requestPath = decodeURIComponent(parsed.pathname);
  if (requestPath.includes('\\') || requestPath.includes('\0')) throw new Error('Invalid path');
  let relativePath = requestPath.replace(/^\/+/, '') || 'index.html';
  if (relativePath.endsWith('/')) relativePath += 'index.html';
  const root = appRoot(), requested = path.resolve(root, relativePath);
  if (requested !== root && !requested.startsWith(root + path.sep)) throw new Error('Forbidden');
  if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
    const fallback = path.resolve(root, relativePath, 'index.html');
    if (fallback.startsWith(root + path.sep) && fs.existsSync(fallback)) return fallback;
  }
  return requested;
}
function external(url) {
  if (url === DRIVER_HELP || url === USB_HELP) return shell.openExternal(url);
  return Promise.reject(new Error('External URL not allowlisted'));
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#0c1015', title: 'EchoLab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true
    }
  });
  mainWindow = win;
  win.webContents.setWindowOpenHandler(({url}) => {
    if (url === DRIVER_HELP || url === USB_HELP) void external(url);
    return {action:'deny'};
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(scheme + '://')) return;
    event.preventDefault();
    if (url === DRIVER_HELP || url === USB_HELP) void external(url);
  });
  win.loadURL(scheme + '://studio/');
}
app.whenReady().then(() => {
  protocol.handle(scheme, request => {
    try {
      const file = resolvePath(request.url);
      return net.fetch(pathToFileURL(file).toString());
    } catch { return new Response('Not found', {status:404}); }
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents === mainWindow?.webContents && permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return webContents === mainWindow?.webContents && permission === 'media';
  });
  ipcMain.handle('echolab:open-official-help', (_event, kind) => {
    if (_event.sender !== mainWindow?.webContents) throw new Error('Invalid sender');
    return external(kind === 'driver' ? DRIVER_HELP : kind === 'usb' ? USB_HELP : '');
  });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
