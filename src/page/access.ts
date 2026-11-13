// Whether the extension may use a site (read its pages, call its API). Without access, the user is
// asked: the agent loop runs the tool again once they allow it.
import { browser } from 'wxt/browser';
import { AccessRequiredError, type AccessRequest } from '../core/types';
import { hostOf } from '../core/util';
import { isRestrictedUrl, originPattern } from './permissions';

// Whether the site of the URL is granted (itself, or every site).
export async function hasAccess(url: string): Promise<boolean> {
  const origin = originPattern(url);
  return (await browser.permissions.contains({ origins: [origin] })) || (await browser.permissions.contains({ origins: ['<all_urls>'] }));
}

// What the extension may do on a tab's page: use it, not until the user grants its site, or never
// (the browser keeps extensions off it: its own pages, the Web Store, local files).
export type PageAccess = 'ok' | 'needs-permission' | 'restricted';
export async function pageAccess(url: string | undefined): Promise<PageAccess> {
  if (!url || isRestrictedUrl(url)) return 'restricted';
  return (await hasAccess(url)) ? 'ok' : 'needs-permission';
}

// What the user is asked to allow for the URL's site; `title`: how the card names it (none: the site).
export function accessRequest(url: string, title?: string): AccessRequest {
  const site = hostOf(url);
  return { origin: originPattern(url), site, title: title || site };
}

export async function requireAccess(url: string, use = 'read'): Promise<void> {
  if (!/^https?:\/\//i.test(url) || isRestrictedUrl(url)) throw new Error(`The browser does not allow to ${use} ${url}.`);
  if (await hasAccess(url)) return;
  const access = accessRequest(url);
  throw new AccessRequiredError(access, `No permission to ${use} ${access.site}: the user has not allowed this site.`);
}

// The access an LLM provider's site needs, asked for from the chat the first time it is used (the
// manifest grants only the OpenAI, Groq and OpenRouter APIs beforehand; local servers are allowed one by one).
export function providerAccess(provider: { name: string; baseURL: string }): AccessRequest {
  return {
    origin: originPattern(provider.baseURL),
    site: hostOf(provider.baseURL),
    title: provider.name,
    reason: `The provider "${provider.name}" is at ${provider.baseURL}: the extension needs access to that site to talk to it.`,
  };
}
