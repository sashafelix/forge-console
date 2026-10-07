import { ipcMain as electronIpcMain } from 'electron';
import { assertTrustedSender } from './trusted-senders';
export const guardedIpcMain = {
  handle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void {
    electronIpcMain.handle(channel, (event, ...args) => { assertTrustedSender(event); return listener(event, ...args); });
  }
};
