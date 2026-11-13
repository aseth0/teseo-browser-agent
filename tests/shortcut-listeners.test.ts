import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every command runs through onShortcut (background/shortcuts), so that a key set in Settings → Shortcuts
// runs it as the browser's shortcut does: a listener of the browser's commands elsewhere misses those keys.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

describe('shortcut listeners', () => {
  it('listen to the commands only through onShortcut', () => {
    const direct = files('src').filter((f) => !f.endsWith(join('background', 'shortcuts.ts')) && readFileSync(f, 'utf8').includes('commands.onCommand'));
    expect(direct).toEqual([]);
  });
});
