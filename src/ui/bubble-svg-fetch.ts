// Settings → Bubble → Your SVG, from a URL: fetched by the options page (never by the page widget),
// once, after the browser gives access to its site, for that download only (access it did not have
// before is given back: else the agent could read the site, and the bubble show there); then made safe
// and kept as a copy. The bubble never loads it from the web.
import { browser } from 'wxt/browser';
import { askOrigins } from './ask-permission';
import { errorText } from '../core/errors';
import { originPattern } from '../page/permissions';
import { MAX_SVG_FETCH, safeSvg, type SvgCheck } from '../widget/svg-safe';

// The body as text, up to `max` bytes: refused past it, without reading the rest.
async function readAtMost(response: Response, max: number): Promise<string | undefined> {
  if (Number(response.headers.get('content-length') ?? 0) > max) return undefined;
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchSvg(address: string): Promise<SvgCheck> {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return { error: "Couldn't fetch it: not a web address." };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: "Couldn't fetch it: only http and https addresses." };
  const origins = [originPattern(url.href)];
  // Asked in the same task as the request, which must still have the click.
  const had = browser.permissions.contains({ origins }).catch(() => false);
  if (!(await askOrigins(...origins))) return { error: `The browser did not give access to ${url.origin}.` };
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) return { error: `Couldn't fetch it: the server answered ${response.status}.` };
    const text = await readAtMost(response, MAX_SVG_FETCH);
    if (text === undefined) return { error: `It is larger than ${MAX_SVG_FETCH / 1024} KB.` };
    return safeSvg(text);
  } catch (e) {
    return { error: `Couldn't fetch it: ${errorText(e)}` };
  } finally {
    if (!(await had)) await browser.permissions.remove({ origins }).catch((e: unknown) => console.error('[bubble]', e));
  }
}
