import { describe, expect, it, vi } from 'vitest';

const updateSessionRules = vi.fn(async (_update: { removeRuleIds: number[]; addRules: { id: number; condition: { requestDomains: string[]; initiatorDomains: string[] } }[] }) => undefined);
const getURL = vi.fn((_path: string) => 'chrome-extension://ext-id/');
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'ext-id', getURL }, declarativeNetRequest: { updateSessionRules } } }));
const { withoutOrigin } = await import('../src/mcp/origin');

const added = async (url: string) => {
  updateSessionRules.mockClear();
  await withoutOrigin(url);
  const [update] = updateSessionRules.mock.calls[0]!;
  return { removed: update.removeRuleIds, rule: update.addRules[0]! };
};

describe('withoutOrigin', () => {
  it("replaces its host's rule: the same id each time, whatever the path", async () => {
    const first = await added('https://mcp.example.com/mcp');
    const again = await added('https://mcp.example.com/other?x=1');
    expect(first.removed).toEqual([first.rule.id]);
    expect(again.rule.id).toBe(first.rule.id);
    expect(first.rule.id).toBeGreaterThanOrEqual(1_000_000);
  });

  it('gives each host a rule of its own', async () => {
    expect((await added('https://a.example.com/mcp')).rule.id).not.toBe((await added('https://b.example.com/mcp')).rule.id);
  });

  it("only takes the Origin out of the extension's own requests to that host", async () => {
    const { rule } = await added('https://mcp.example.com:8443/mcp');
    expect(rule.condition).toMatchObject({ requestDomains: ['mcp.example.com'], initiatorDomains: ['ext-id'] });
  });

  it("names the extension by its pages' host, which in Firefox is not its id", async () => {
    getURL.mockReturnValueOnce('moz-extension://11111111-2222-4333-8444-555555555555/');
    const { rule } = await added('https://mcp.example.com/mcp');
    expect(rule.condition.initiatorDomains).toEqual(['11111111-2222-4333-8444-555555555555']);
  });
});
