import { promises as fs } from 'node:fs';
import { buildProjectProfile } from '../shared/project-profile';

/** Only the native save dialog may supply destination. Commands remain inert text. */
export async function writeProjectProfile(destination: string, draft: unknown): Promise<void> {
  const content = `${JSON.stringify(buildProjectProfile(draft), null, 2)}\n`;
  // Never replace an existing configuration or follow a pre-existing symlink.
  await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}
