// Asks the browser for a permission, from the user's click. A refusal, or a request the browser
// rejects (not from a click, a pattern it does not take), is a no.
import { browser } from 'wxt/browser';
import { originPattern } from '../page/permissions';

export const askPermission = (permissions: Parameters<typeof browser.permissions.request>[0]): Promise<boolean> =>
  browser.permissions.request(permissions).catch(() => false);

// Access to these sites (origin patterns).
export const askOrigins = (...origins: string[]) => askPermission({ origins });

// The site of `url`, asked for from a click: a no is an error saying so.
export async function askSite(url: string): Promise<void> {
  const origin = originPattern(url);
  if (!(await askOrigins(origin))) throw new Error(`Access to ${origin} was not granted.`);
}

// Reaching a server needs the browser's permission for its site, asked from a click (only when not
// given yet: after a sign-in window the click is long gone). A request the browser rejects is its error.
export async function allowSite(url: string): Promise<void> {
  const origins = [originPattern(url)];
  if (await browser.permissions.contains({ origins })) return;
  if (!(await browser.permissions.request({ origins }))) throw new Error(`Permission denied for ${origins[0]}`);
}
