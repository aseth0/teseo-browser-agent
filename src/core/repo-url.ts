// The project's repository, as a plain https URL: TESEO_REPO_URL when the build sets it (a fork), else
// package.json's `repository` (or `homepage`). It must be a GitHub repository: the links are GitHub's
// (core/links: /releases/latest, /issues, /blob/<ref>/). Read by wxt.config.ts, which injects it
// (__REPO_URL__, core/links), and by the test that checks the docs' links. No browser API here: it runs in Node.
export interface PackageRepo {
  repository?: string | { url?: string };
  homepage?: string;
}

// git+https://github.com/o/r.git, https://github.com/o/r#readme, github:o/r, o/r, git@github.com:o/r.git,
// ssh://git@github.com/o/r.git → https://github.com/o/r. Anything else that is not https:// stops the build:
// a link that is not absolute would open inside the extension's own page.
export function normalizeRepoUrl(url: string): string {
  let u = url.trim().replace(/^git\+/, '').replace(/#.*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(u);
  if (short) u = `https://github.com/${short[1]}`;
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u); // git@host:owner/name
  if (scp) u = `https://${scp[1]}/${scp[2]}`;
  u = u.replace(/^(?:ssh|git):\/\/(?:[\w.-]+@)?/, 'https://').replace(/^http:\/\//, 'https://').replace(/\.git$/, '');
  if (!/^https:\/\/[\w.-]+\/\S+$/.test(u)) throw new Error(`The repository "${url}" is not an https URL: set TESEO_REPO_URL to https://github.com/<owner>/<name>.`);
  return u;
}

export function repoUrlOf(pkg: PackageRepo, env: Record<string, string | undefined> = {}): string {
  const fromEnv = env.TESEO_REPO_URL?.trim();
  if (fromEnv) return normalizeRepoUrl(fromEnv);
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const url = repo || pkg.homepage;
  if (!url) throw new Error('package.json has no repository or homepage: set TESEO_REPO_URL.');
  return normalizeRepoUrl(url);
}

// A release's build links the docs at its tag: built from tag vX.Y.Z of this version (release.yml), in the
// repository the links point to. A tag pushed to another one (a private copy) does not exist in the one
// linked, so its build links the default branch.
export function isReleaseBuild(version: string, repo: string, env: Record<string, string | undefined>): boolean {
  const slug = githubSlug(repo);
  return env.GITHUB_REF_TYPE === 'tag' && env.GITHUB_REF_NAME === `v${version}` && !!slug && env.GITHUB_REPOSITORY?.toLowerCase() === slug;
}

// "owner/name" of a GitHub repository URL, lower-cased (GitHub's are case-insensitive); undefined for another host.
export function githubSlug(url: string): string | undefined {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?)]+)/i.exec(url);
  return m ? `${m[1]}/${m[2]!.replace(/\.git$/, '')}`.toLowerCase() : undefined;
}
