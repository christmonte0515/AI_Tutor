const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');

const serverUrl = process.env.AI_TUTOR_SERVER_URL || 'http://localhost:3000';
const icon = path.join(__dirname, 'renderer', 'img', 'student.png');

if (process.platform === 'win32') app.setAppUserModelId('edu.school.ai-tutor.student');
Menu.setApplicationMenu(null);

ipcMain.on('get-config', (event) => {
  event.returnValue = { serverUrl };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 360,
    minHeight: 500,
    title: 'AI Tutor',
    icon,
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
