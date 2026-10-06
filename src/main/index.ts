import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerTrustedSender } from './trusted-senders';
import { terminateAllAgentProcesses } from './agent-processes';
import { recoverInterruptedAgentRuns } from './interrupted-run-recovery';
import { registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;
let connectionsWindow: BrowserWindow | null = null;
let providerShutdownStarted = false;

function stopProviderProcesses(): void {
  if (providerShutdownStarted) return;
  providerShutdownStarted = true;
  terminateAllAgentProcesses(true);
}

function windowOptions(title: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

function loadRenderer(window: BrowserWindow, page: 'index.html' | 'connections.html'): void {
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  const target = developmentUrl
    ? new URL(page, developmentUrl.endsWith('/') ? developmentUrl : `${developmentUrl}/`).toString()
    : pathToFileURL(path.join(__dirname, '..', '..', 'renderer', page)).toString();
  const unregister = registerTrustedSender(window.webContents.id, [target]);
  window.once('closed', unregister);
  window.webContents.on('will-navigate', (event, url) => { const parsed = new URL(url); parsed.hash = ''; if (parsed.toString() !== target) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (developmentUrl) {
    void window.loadURL(new URL(page, developmentUrl.endsWith('/') ? developmentUrl : `${developmentUrl}/`).toString());
    if (process.env.OPEN_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '..', '..', 'renderer', page));
  }
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }
  mainWindow = new BrowserWindow(windowOptions('Forge Console — Quality Workbench'));
  loadRenderer(mainWindow, 'index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function createConnectionsWindow(): BrowserWindow {
  if (connectionsWindow && !connectionsWindow.isDestroyed()) {
    connectionsWindow.focus();
    return connectionsWindow;
  }
  connectionsWindow = new BrowserWindow(windowOptions('Forge Console — Connections'));
  loadRenderer(connectionsWindow, 'connections.html');
  connectionsWindow.on('closed', () => { connectionsWindow = null; });
  return connectionsWindow;
}

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      label: 'Forge Console',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }
  template.push(
    {
      label: 'Workspaces',
      submenu: [
        { label: 'Quality Workbench', accelerator: 'CmdOrCtrl+1', click: () => { createMainWindow(); } },
        { label: 'Connections', accelerator: 'CmdOrCtrl+,', click: () => { createConnectionsWindow(); } }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'close' as const }])] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  const recoveredRuns = await recoverInterruptedAgentRuns();
  if (recoveredRuns > 0) console.warn(`Recovered ${recoveredRuns} agent run(s) interrupted by a previous app shutdown.`);
  registerIpcHandlers(() => { createConnectionsWindow(); });
  app.setAboutPanelOptions({ applicationName: 'Forge Console' });
  installApplicationMenu();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', stopProviderProcesses);

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
  process.once(signal, () => {
    stopProviderProcesses();
    process.exit(exitCode);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
