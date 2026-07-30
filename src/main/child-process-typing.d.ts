import 'node:child_process';

declare module 'node:child_process' {
  /**
   * Validation commands intentionally ignore stdin while keeping stdout and stderr
   * piped. The controller only stores the process for cancellation and output
   * handling; it never writes to stdin after spawn.
   */
  export function spawn(
    command: string,
    args: readonly string[],
    options: {
      cwd: string;
      env: NodeJS.ProcessEnv;
      shell: boolean;
      windowsHide: boolean;
      stdio: ['ignore', 'pipe', 'pipe'];
    }
  ): ChildProcessWithoutNullStreams;
}
