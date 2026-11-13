// URL helpers for host permissions. Pure: safe to import from any context.

// Pages where no extension can inject scripts.
const RESTRICTED = /^(chrome|chrome-extension|edge|vivaldi|brave|opera|about|devtools|view-source|file):|^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/;

export function isRestrictedUrl(url: string | undefined): boolean {
  return !url || RESTRICTED.test(url);
}

// Chrome match patterns do not accept a port; without one they match every port.
export function originPattern(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

// What the user typed for a site, as a URL: a bare host means https.
const siteUrl = (input: string) => {
  const text = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
};
// As a match pattern ("Add site…").
export const sitePattern = (input: string): string => originPattern(siteUrl(input));
// As the host a policy is kept for (an agent's sites); throws when it is not a URL at all.
export const siteHost = (input: string): string => new URL(siteUrl(input)).host;

// Origins granted at runtime: everything granted minus the manifest's fixed hosts and <all_urls>.
export function grantedSites(granted: string[], fixed: string[]): string[] {
  const skip = new Set([...fixed, '<all_urls>']);
  return [...new Set(granted.filter((o) => !skip.has(o)))].sort();
}

// The host a site policy is keyed by, for a granted pattern; undefined for wildcard hosts.
export function patternHost(pattern: string): string | undefined {
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)\//i.exec(pattern)?.[1];
  return host && !host.includes('*') ? host : undefined;
}
