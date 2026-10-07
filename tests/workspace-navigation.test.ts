import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import * as url from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { IPC_CHANNELS } from '../src/shared/channels';
import type { DesktopApi, WorkspacePage } from '../src/shared/contracts';

async function runModule(file: string, modules: Record<string, unknown>, extras: Record<string, unknown> = {}) {
  const source = await readFile(new URL('../src/main/' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  vm.runInNewContext(outputText, { exports: {}, __dirname: '/fixture/dist/electron/main', console,
    require: (name: string) => { if (!(name in modules)) throw new Error('Unexpected dependency: ' + name); return modules[name]; }, ...extras });
}

test('menu, shortcut and button requests navigate one main window, including while it loads', async () => {
  const windows: FakeWindow[] = [];
  const sent: [string, WorkspacePage][] = [];
  let menu: any[] = [];
  let openConnections!: () => void;
  class FakeWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((window) => !window.destroyed); }
    destroyed = false;
    loading = true;
    minimized = false;
    loaded: string[] = [];
    webContents = Object.assign(new EventEmitter(), {
      id: windows.length + 1,
      session: { setPermissionRequestHandler() {} },
      setWindowOpenHandler() {},
      isLoadingMainFrame: () => this.loading,
      send: (channel: string, page: WorkspacePage) => sent.push([channel, page])
    });
    constructor(public options: any) { super(); windows.push(this); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    focus() {}
    loadFile(file: string) { this.loaded.push(file); return Promise.resolve(); }
    finishLoading() { this.loading = false; this.webContents.emit('did-finish-load'); }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  await runModule('index.ts', {
    electron: { BrowserWindow: FakeWindow, app: { whenReady: () => Promise.resolve(), on() {}, setAboutPanelOptions() {} },
      Menu: { buildFromTemplate: (template: any[]) => template, setApplicationMenu: (template: any[]) => { menu = template; } } },
    'node:path': path, 'node:url': url, '../shared/channels': { IPC_CHANNELS },
    './trusted-senders': { registerTrustedSender: () => () => undefined },
    './agent-processes': { terminateAllAgentProcesses() {} },
    './interrupted-run-recovery': { recoverInterruptedAgentRuns: async () => 0 },
    './ipc': { registerIpcHandlers: (callback: () => void) => { openConnections = callback; } }
  }, { process: { platform: 'darwin', env: {}, once() {} } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const workspaces = menu.find((item) => item.label === 'Workspaces').submenu;
  const connections = workspaces.find((item: any) => item.label === 'Connections');
  assert.equal(connections.accelerator, 'CmdOrCtrl+,');
  connections.click();
  assert.equal(windows.length, 1);
  assert.deepEqual(sent, []);
  windows[0].finishLoading();
  assert.deepEqual(sent.at(-1), [IPC_CHANNELS.workspaceNavigate, 'connections']);
  windows[0].minimized = true;
  openConnections();
  assert.equal(windows.length, 1);
  assert.equal(windows[0].minimized, false);
  workspaces.find((item: any) => item.label === 'Quality Workbench').click();
  assert.deepEqual(sent.at(-1), [IPC_CHANNELS.workspaceNavigate, 'workbench']);
  windows[0].close();
  connections.click();
  assert.equal(FakeWindow.getAllWindows().length, 1);
  assert.equal(windows[1].loaded.length, 1);
  assert.ok(windows[1].loaded[0].endsWith('/renderer/index.html'));
  windows[1].finishLoading();
  assert.deepEqual(sent.at(-1), [IPC_CHANNELS.workspaceNavigate, 'connections']);
  assert.equal(windows[1].options.webPreferences.contextIsolation, true);
});

test('preload queues early navigation, validates destinations and cleans up subscriptions', async () => {
  const ipc = Object.assign(new EventEmitter(), { invoke: async (channel: string) => channel });
  let api!: DesktopApi;
  await runModule('preload.ts', { electron: { ipcRenderer: ipc, contextBridge: {
    exposeInMainWorld: (_key: string, value: DesktopApi) => { api = value; }
  } } });
  ipc.emit(IPC_CHANNELS.workspaceNavigate, { secret: 'must not cross the bridge' }, 'connections');
  const destinations: WorkspacePage[] = [];
  const unsubscribe = api.onWorkspaceNavigate((page) => destinations.push(page));
  assert.deepEqual(destinations, ['connections']);
  ipc.emit(IPC_CHANNELS.workspaceNavigate, {}, 'https://untrusted.example');
  assert.deepEqual(destinations, ['connections']);
  ipc.emit(IPC_CHANNELS.workspaceNavigate, {}, 'workbench');
  assert.deepEqual(destinations, ['connections', 'workbench']);
  unsubscribe();
  ipc.emit(IPC_CHANNELS.workspaceNavigate, {}, 'connections');
  assert.equal(destinations.length, 2);
  assert.equal(await api.openConnections(), IPC_CHANNELS.openConnections);
});
