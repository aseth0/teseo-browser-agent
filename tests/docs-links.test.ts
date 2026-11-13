import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_IDS, featureIn } from '../src/core/build';
import { githubSlug, repoUrlOf } from '../src/core/repo-url';

// Every link of the docs to a GitHub repository points to the project's, as the build sets it
// (core/repo-url: package.json, or TESEO_REPO_URL): a link to an old or private one fails here. Left out:
// example repositories (github.com/example/…) and vendor notices.
const configured = githubSlug(repoUrlOf(JSON.parse(readFileSync('package.json', 'utf8')), process.env));
const isVendor = (file: string) => /(^|\/)vendor\/|NOTICE|THIRD[-_]PARTY/i.test(file);

function markdownIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? markdownIn(path) : name.endsWith('.md') ? [path] : [];
  });
}

function foreignRepoLinks(files: { file: string; text: string }[], slug: string | undefined): string[] {
  return files.filter(({ file }) => !isVendor(file)).flatMap(({ file, text }) =>
    [...text.matchAll(/https?:\/\/(?:www\.)?github\.com\/[^\s)>"'`\]]+/gi)]
      .map((m) => m[0])
      .filter((url) => {
        const found = githubSlug(url);
        return found !== undefined && !found.startsWith('example/') && found !== slug;
      })
      .map((url) => `${file}: ${url}`));
}

describe('the links of the docs', () => {
  it('point to no repository but the configured one', () => {
    const files = [...markdownIn('docs'), 'README.md', 'CONTRIBUTING.md'].map((file) => ({ file, text: readFileSync(file, 'utf8') }));
    expect(configured).toBeDefined();
    expect(foreignRepoLinks(files, configured)).toEqual([]);
  });

  it('a link to another repository fails; an example one or a vendor notice does not', () => {
    const doc = (file: string, text: string) => ({ file, text });
    expect(foreignRepoLinks([
      doc('docs/a.md', 'See [it](https://github.com/someone/old-name/releases).'),
      doc('docs/b.md', 'Like `https://github.com/example/skills/blob/main/skills.json`.'),
      doc('docs/vendor/NOTICE.md', 'From https://github.com/microsoft/playwright.'),
      doc('docs/c.md', 'Clone https://github.com/owner/repo.git and [here](https://github.com/Owner/Repo/issues).'),
    ], 'owner/repo')).toEqual(['docs/a.md: https://github.com/someone/old-name/releases']);
  });
});

// GitHub's anchor of a heading: lower case, its punctuation dropped, spaces as hyphens.
const anchorOf = (heading: string) => heading.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');

describe('the docs page of each feature a version may lack (core/build)', () => {
  it('exists, with its heading', () => {
    for (const id of FEATURE_IDS) {
      const [file, anchor] = featureIn(id, { store: false, leavesOut: [], browser: {} }).docs.split('#');
      const text = readFileSync(file!, 'utf8');
      if (anchor) expect([...text.matchAll(/^#+ (.+)$/gm)].map((m) => anchorOf(m[1]!)), `${id}: ${file}#${anchor}`).toContain(anchor);
    }
  });
});
