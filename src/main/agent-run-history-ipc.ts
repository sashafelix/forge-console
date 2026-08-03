import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/channels';
import { getAgentExecutionEvents, getLatestAgentExecutionRun } from './agent-run-history';

export function registerAgentRunHistoryIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getLatestAgentExecutionRun, getLatestAgentExecutionRun);
  ipcMain.handle(IPC_CHANNELS.getAgentExecutionEvents, (_event, runId: string) => getAgentExecutionEvents(runId));
}
