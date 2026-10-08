const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appConfig', ipcRenderer.sendSync('get-config'));
