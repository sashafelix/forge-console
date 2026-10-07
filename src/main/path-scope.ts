import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Open directories explicitly selected by the operator or owned by the application. */
export async function approvedOpenDirectory(value: unknown, roots: string[]): Promise<string> {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid folder path.');
  const target = await fs.realpath(path.resolve(value));
  if (!(await fs.stat(target)).isDirectory()) throw new Error('Open folder accepts directories only.');
  for (const root of roots) {
    const realRoot = await fs.realpath(root);
    const relative = path.relative(realRoot, target);
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) return target;
  }
  throw new Error('Select this folder through the native picker before opening it.');
}
