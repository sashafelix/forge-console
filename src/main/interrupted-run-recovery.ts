import { app } from 'electron';
import path from 'node:path';
import { recoverInterruptedRunsAtRoot } from './interrupted-run-recovery-core';

export { recoverInterruptedRunsAtRoot } from './interrupted-run-recovery-core';

export async function recoverInterruptedAgentRuns(): Promise<number> {
  return recoverInterruptedRunsAtRoot(path.join(app.getPath('userData'), 'runs'));
}
