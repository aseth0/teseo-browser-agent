// Every link out of the extension to the project: its repository, its releases, its issues and a page of
// its docs. The repository is set once, at build time (core/repo-url: package.json, or TESEO_REPO_URL),
// so nothing here is edited for a release: releases point at the latest, and the docs at the installed
// version's tag in a release's build (built from that tag, release.yml), else at the default branch.
import { browser } from 'wxt/browser';

export const DEFAULT_BRANCH = 'master';

// A page of the docs, from the repository's root, with its anchor if any: 'docs/guide/speak.md#reading'.
export type DocsPage = `${'docs/' | 'README.md' | 'CONTRIBUTING.md'}${string}`;

export interface Links {
  repo: string;
  releases: string;
  issues: string;
  docs: (page: DocsPage) => string;
}

// The git ref the docs are read at: the version's tag in a release's build, the default branch in any
// other (a dev build, a branch's, a version not released yet).
export const docsRef = (version: string | undefined, release: boolean): string => (release && version ? `v${version}` : DEFAULT_BRANCH);

export function linksFor({ repo, version, release }: { repo: string; version?: string; release: boolean }): Links {
  const ref = docsRef(version, release);
  return {
    repo,
    releases: `${repo}/releases/latest`,
    issues: `${repo}/issues`,
    docs: (page) => `${repo}/blob/${ref}/${page}`,
  };
}

const builtRepo = (): string => (typeof __REPO_URL__ !== 'undefined' ? __REPO_URL__ : '');
const releaseBuild = (): boolean => typeof __RELEASE_BUILD__ !== 'undefined' && __RELEASE_BUILD__;
export const installedVersion = (): string | undefined => {
  try {
    return browser.runtime?.getManifest?.().version;
  } catch {
    return undefined;
  }
};

// This build's links.
export const links = (): Links => linksFor({ repo: builtRepo(), version: installedVersion(), release: releaseBuild() });
