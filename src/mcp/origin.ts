// The extension's requests to an MCP server go without an Origin header, as a desktop client's do.
// The MCP spec has servers check Origin (against DNS rebinding), and some refuse
// "chrome-extension://<id>" (Notion: "Invalid Origin"). One session rule per server host, taking it out
// of the extension's own requests only (initiator: this extension), added before connecting.
import { browser } from 'wxt/browser';

// The host this extension's requests come from: its id in Chrome, this installation's UUID in Firefox
// (where runtime.id is the add-on's id, "name@owner": not a domain, and the rule is refused whole).
const ownHost = () => new URL(browser.runtime.getURL('/')).hostname;

const FIRST_RULE = 1_000_000; // above any other rule this extension may add

// The host's rule id: the same from every context (Settings and the background), so adding it twice
// only replaces it.
const ruleId = (host: string) => {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) % 1_000_000_000;
  return FIRST_RULE + h;
};

export async function withoutOrigin(url: string): Promise<void> {
  const host = new URL(url).hostname;
  const id = ruleId(host);
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
      condition: { requestDomains: [host], initiatorDomains: [ownHost()], resourceTypes: ['xmlhttprequest', 'other'] },
    }],
  });
}
