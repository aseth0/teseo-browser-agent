// Types of release-notes.mjs, for its test.
export interface Checksum {
  name: string;
  sha256: string;
}

export function assetNames(name: string, version: string): { zip: string; storeZip: string; firefoxZip: string; firefoxSources: string };
export function changelogSection(changelog: string, version: string): string;
export function unwrap(markdown: string): string;
export function checksumsBlock(sums?: Checksum[]): string;
export function sha256Of(file: string): string;
export function main(argv: string[], env: Record<string, string | undefined>): string;
export function releaseNotes(input: { template: string; changelog: string; version: string; repo: string; name: string; sums?: Checksum[] }): string;
