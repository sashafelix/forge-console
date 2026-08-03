import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const DEFAULT_FORCE_KILL_DELAY_MS = 3_000;
const managedProcesses = new Set<ChildProcessWithoutNullStreams>();
const originalKillMethods = new WeakMap<ChildProcessWithoutNullStreams, ChildProcessWithoutNullStreams['kill']>();
const escalationTimers = new WeakMap<ChildProcessWithoutNullStreams, NodeJS.Timeout>();

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function clearEscalation(child: ChildProcessWithoutNullStreams): void {
  const timer = escalationTimers.get(child);
  if (timer) clearTimeout(timer);
  escalationTimers.delete(child);
}

function taskkill(pid: number, force: boolean): boolean {
  try {
    const killer = spawn('taskkill', [
      '/PID', String(pid),
      '/T',
      ...(force ? ['/F'] : [])
    ], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.unref();
    return true;
  } catch {
    return false;
  }
}

function sendSignal(
  child: ChildProcessWithoutNullStreams,
  originalKill: ChildProcessWithoutNullStreams['kill'],
  signal: NodeJS.Signals | number
): boolean {
  if (!child.pid || hasExited(child)) return false;
  if (signal === 0) return originalKill.call(child, signal);
  if (process.platform === 'win32') {
    const force = signal === 'SIGKILL' || signal === 9;
    return taskkill(child.pid, force);
  }
  try {
    return originalKill.call(child, signal);
  } catch {
    return false;
  }
}

export function manageAgentProcess(
  child: ChildProcessWithoutNullStreams,
  forceKillDelayMs = DEFAULT_FORCE_KILL_DELAY_MS
): ChildProcessWithoutNullStreams {
  const originalKill = child.kill;
  originalKillMethods.set(child, originalKill);
  managedProcesses.add(child);

  const cleanup = () => {
    clearEscalation(child);
    managedProcesses.delete(child);
    originalKillMethods.delete(child);
  };
  child.once('close', cleanup);
  child.once('error', cleanup);

  child.kill = ((signal: NodeJS.Signals | number = 'SIGTERM') => {
    const sent = sendSignal(child, originalKill, signal);
    if (signal !== 0 && signal !== 'SIGKILL' && signal !== 9 && !hasExited(child)) {
      clearEscalation(child);
      const timer = setTimeout(() => {
        escalationTimers.delete(child);
        if (!hasExited(child)) sendSignal(child, originalKill, 'SIGKILL');
      }, forceKillDelayMs);
      timer.unref();
      escalationTimers.set(child, timer);
    }
    return sent;
  }) as ChildProcessWithoutNullStreams['kill'];

  return child;
}

export function terminateAllAgentProcesses(force = true): void {
  for (const child of [...managedProcesses]) {
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // The process may already have exited between enumeration and termination.
    }
  }
}

export function activeAgentProcessCount(): number {
  return [...managedProcesses].filter((child) => !hasExited(child)).length;
}
