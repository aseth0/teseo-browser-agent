// A release's notes: .github/release-notes.md filled with the version, its section of CHANGELOG.md, the two zips'
// names and the repository's URL (src/core/repo-url.ts: package.json, or TESEO_REPO_URL), printed to stdout.
// release.yml's publish job passes the folder with the zips, whose SHA-256 go in the notes; without it (a preview)
// that section says they are computed when the release is published. No dependency: Node 22.18+ runs the .ts import.
//   node scripts/release-notes.mjs 0.72.0 [folder with the zips]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoUrlOf } from '../src/core/repo-url.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// The zips release.yml attaches (wxt.config.ts: wxt's default name, and the store's `-store` one).
export function assetNames(name, version) {
  return { zip: `${name}-${version}-chrome.zip`, storeZip: `${name}-${version}-chrome-store.zip` };
}

// The body of `## <version>` in the changelog, up to the next `## ` heading; an error when there is none.
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section: add it before releasing.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md's "## ${version}" section is empty.`);
  return body;
}

// The changelog wraps its items at 120 columns; a release's body shows each line break as one. An indented line
// that does not start a nested item joins the line before it (code blocks kept as they are).
export function unwrap(markdown) {
  const out = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const continues = !fenced && /^\s+\S/.test(line) && !/^\s*([-*+]|\d+[.)])\s/.test(line) && !/^\s*```/.test(line);
    if (continues && out.length && out[out.length - 1].trim()) out[out.length - 1] += ' ' + line.trim();
    else out.push(line);
  }
  return out.join('\n');
}

// `sha256  name` lines in a code block, or a note when there are no zips to hash (a preview).
export function checksumsBlock(sums) {
  if (!sums) return '_Computed when the release is published._';
  return ['```', ...sums.map(({ name, sha256 }) => `${sha256}  ${name}`), '```'].join('\n');
}

export function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function releaseNotes({ template, changelog, version, repo, name, sums }) {
  const values = {
    version,
    tag: `v${version}`,
    repo,
    ...assetNames(name, version),
    changes: unwrap(changelogSection(changelog, version)),
    checksums: checksumsBlock(sums),
  };
  const body = template.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  // One pass: a placeholder-like text inside the changelog is left as it is.
  const out = body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`.github/release-notes.md: unknown placeholder ${match}.`);
    return values[key];
  });
  return out.trimEnd() + '\n';
}

// The page for argv [version, folder with the zips?], from this repository's files; an Error saying what is wrong.
export function main(argv, env) {
  const version = (argv[0] ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Usage: node scripts/release-notes.mjs X.Y.Z [folder with the zips]');
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dir = argv[1];
  const sums = dir
    ? Object.values(assetNames(pkg.name, version)).map((n) => {
        try {
          return { name: n, sha256: sha256Of(join(dir, n)) };
        } catch {
          throw new Error(`No ${n} in ${dir}.`);
        }
      })
    : undefined;
  return releaseNotes({
    template: readFileSync(join(root, '.github/release-notes.md'), 'utf8'),
    changelog: readFileSync(join(root, 'CHANGELOG.md'), 'utf8'),
    version,
    repo: repoUrlOf(pkg, env),
    name: pkg.name,
    sums,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(main(process.argv.slice(2), process.env));
  } catch (e) {
    console.error(`release-notes: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
