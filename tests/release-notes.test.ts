import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetNames, changelogSection, main, releaseNotes, unwrap } from '../scripts/release-notes.mjs';
import { repoUrlOf } from '../src/core/repo-url';

const changelog = `# Changelog

## Unreleased

### Added
- Something not released yet.

## 1.2.0

### Added
- A new thing.

### Fixed
- An old bug.

## 1.1.0

### Changed
- Something before.
`;

const template = readFileSync('.github/release-notes.md', 'utf8');
const repo = 'https://github.com/example/teseo';

describe('release notes', () => {
  it('takes the version section of the changelog, up to the next version', () => {
    expect(changelogSection(changelog, '1.2.0')).toBe('### Added\n- A new thing.\n\n### Fixed\n- An old bug.');
    expect(changelogSection(changelog, '1.1.0')).toBe('### Changed\n- Something before.');
  });

  it('fails clearly when the changelog has no section for the version', () => {
    expect(() => changelogSection(changelog, '1.3.0')).toThrow('CHANGELOG.md has no "## 1.3.0" section');
    // 0.7.0 is not 0.70.0's prefix, nor 0x7x0.
    expect(() => changelogSection('## 0.70.0\n- Seventy.', '0.7.0')).toThrow('no "## 0.7.0" section');
    expect(() => changelogSection('## 0x7x0\n- No.', '0.7.0')).toThrow('no "## 0.7.0" section');
    expect(() => changelogSection('## 1.2.0\n\n## 1.1.0\n- x', '1.2.0')).toThrow('is empty');
  });

  it('builds every link from the repository URL, at the version tag', () => {
    const notes = releaseNotes({ template, changelog, version: '1.2.0', repo, name: 'teseo-browser-agent' });
    const { zip, storeZip } = assetNames('teseo-browser-agent', '1.2.0');
    expect(notes).toContain(`${repo}/releases/download/v1.2.0/${zip}`);
    expect(notes).toContain(`${repo}/releases/download/v1.2.0/${storeZip}`);
    expect(notes).toContain(`${repo}/archive/refs/tags/v1.2.0.zip`);
    expect(notes).toContain(`${repo}/blob/v1.2.0/docs/guide/getting-started.md#the-downloadable-version`);
    expect(notes).toContain(`${repo}/blob/v1.2.0/docs/guide/getting-started.md#the-chrome-web-store-version`);
    expect(notes).toContain(`git clone --branch dist --single-branch ${repo}.git`);
    const links = [...notes.matchAll(/\]\((https?:[^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(5);
    for (const l of links) expect(l.startsWith(`${repo}/`)).toBe(true);
    expect(notes).not.toMatch(/\{\{|<!--/);
    expect(notes).toContain('- A new thing.');
    expect(notes).not.toContain('Something before');
    expect(notes).toContain('Computed when the release is published');
  });

  it('honours TESEO_REPO_URL, as the build does', () => {
    const fork = repoUrlOf({ repository: { url: 'git+https://github.com/example/teseo.git' } }, { TESEO_REPO_URL: 'git@github.com:someone/fork.git' });
    const notes = releaseNotes({ template, changelog, version: '1.2.0', repo: fork, name: 'teseo-browser-agent' });
    expect(notes).toContain('https://github.com/someone/fork/releases/download/v1.2.0/');
    expect(notes).not.toContain('example/teseo');
  });

  it('lists the SHA-256 of both zips, and leaves placeholders inside the changelog alone', () => {
    const sums = [
      { name: 'a-chrome.zip', sha256: 'a'.repeat(64) },
      { name: 'a-chrome-store.zip', sha256: 'b'.repeat(64) },
    ];
    const notes = releaseNotes({ template, changelog: '## 1.2.0\n- Mentions {{repo}} literally.', version: '1.2.0', repo, name: 'a', sums });
    expect(notes).toContain(`\`\`\`\n${'a'.repeat(64)}  a-chrome.zip\n${'b'.repeat(64)}  a-chrome-store.zip\n\`\`\``);
    expect(notes).toContain('Mentions {{repo}} literally.');
  });

  it('joins the changelog wrapped lines, keeping nested items and code', () => {
    const md = '- One item\n  wrapped here.\n  - A nested item\n    wrapped too.\n  **Bold** continues.\n\n```\n  code stays\n```';
    expect(unwrap(md)).toBe('- One item wrapped here.\n  - A nested item wrapped too. **Bold** continues.\n\n```\n  code stays\n```');
  });

  it('refuses a placeholder it does not know', () => {
    expect(() => releaseNotes({ template: '{{nope}}', changelog, version: '1.2.0', repo, name: 'a' })).toThrow('unknown placeholder {{nope}}');
  });

  it('names the zips as wxt.config.ts makes them', () => {
    // wxt's default artifactTemplate for the downloadable zip; wxt.config.ts sets the store's.
    const store = /artifactTemplate: '([^']+)'/.exec(readFileSync('wxt.config.ts', 'utf8'))?.[1];
    expect(store).toBe('{{name}}-{{version}}-{{browser}}-store.zip');
    const fill = (t: string) => t.replace('{{name}}', 'teseo-browser-agent').replace('{{version}}', '1.2.0').replace('{{browser}}', 'chrome');
    expect(assetNames('teseo-browser-agent', '1.2.0')).toEqual({
      zip: fill('{{name}}-{{version}}-{{browser}}.zip'),
      storeZip: fill(store ?? ''),
    });
  });
});

describe('release notes from the command line (main)', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; repository?: { url?: string } };
  const own = repoUrlOf(pkg);

  it('links the repository the release runs in, not package.json\'s, given TESEO_REPO_URL', () => {
    const notes = main(['0.72.0'], { TESEO_REPO_URL: 'https://github.com/example/private-copy' });
    expect(notes).toContain('https://github.com/example/private-copy/releases/download/v0.72.0/');
    expect(notes).not.toContain(own);
    expect(main(['v0.72.0'], {})).toContain(`${own}/releases/download/v0.72.0/`);
  });

  it('refuses what is not a version, and a folder without both zips', () => {
    expect(() => main(['Unreleased'], {})).toThrow('Usage');
    expect(() => main([], {})).toThrow('Usage');
    const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const { zip, storeZip } = assetNames(pkg.name, '0.72.0');
    writeFileSync(join(dir, zip), 'zip');
    expect(() => main(['0.72.0', dir], {})).toThrow(`No ${storeZip} in ${dir}.`);
    writeFileSync(join(dir, storeZip), 'store');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(main(['0.72.0', dir], {})).toContain(`${sha('zip')}  ${zip}\n${sha('store')}  ${storeZip}\n`);
  });
});
