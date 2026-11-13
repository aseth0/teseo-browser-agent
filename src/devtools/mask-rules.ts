// Settings → Chromium DevTools: more fields to mask in browser.screenshot on the engine, one "host selector" per
// line ("#" starts a comment). A line's host covers its subdomains too.
export function maskSelectorsFor(rules: string | undefined, host: string): string[] {
  const selectors: string[] = [];
  for (const raw of (rules ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const space = line.indexOf(' ');
    if (space < 0) continue;
    const of = line.slice(0, space).toLowerCase();
    const selector = line.slice(space + 1).trim();
    if (selector && (host === of || host.endsWith(`.${of}`))) selectors.push(selector);
  }
  return selectors;
}
