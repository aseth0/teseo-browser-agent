// The action editor's tool select: its tools under their groups, the custom ones last, and the custom
// tools an action on page load cannot run, listed but not to pick.
import { describe, expect, it } from 'vitest';
import type { ToolInfo } from '../src/core/protocol';
import { BLOCKED_ON_LOAD, blockedOnLoad, toolOptionGroups } from '../src/ui/widget-actions/tool-options';

const tool = (name: string, source: ToolInfo['source'], effect: ToolInfo['effect'], group?: string): ToolInfo =>
  ({ name, description: '', inputSchema: { type: 'object' }, source, effect, ...(group && { group }) });

const page = tool('browser.get_page_text', 'browser', 'read');
const click = tool('browser.click', 'browser', 'write');
const search = tool('web.search', 'web', 'read');
const wiki = tool('wiki.search', 'custom', 'read');
const chat = tool('chat.post', 'custom', 'write', 'custom:Chat');
const channels = tool('chat.channels', 'custom', 'read', 'custom:Chat');

describe("the action editor's tool select", () => {
  it('lists the tools under their groups, the custom ones last', () => {
    const groups = toolOptionGroups([wiki, click, chat, search, page, channels]);
    expect(groups.map((g) => g.label)).toEqual(['Browser', 'Web (search and read)', 'Custom tools · Chat', 'Custom tools (yours)']);
    expect(groups[0]!.options).toEqual([{ name: 'browser.click', label: 'browser.click (asks first)' }, { name: 'browser.get_page_text', label: 'browser.get_page_text' }]);
    expect(groups[2]!.options.map((o) => o.label)).toEqual(['chat.channels', 'chat.post (asks first)']);
  });

  it('on page load keeps the custom tools that change things, not to pick', () => {
    const all = [page, click, search, wiki, chat, channels];
    const blocked = blockedOnLoad(all);
    expect(blocked).toEqual([chat]);
    const groups = toolOptionGroups(all.filter((t) => t.effect === 'read'), blocked);
    expect(groups.flatMap((g) => g.options).map((o) => o.name)).toEqual(['browser.get_page_text', 'web.search', 'chat.channels', 'chat.post', 'wiki.search']);
    expect(groups.find((g) => g.id === 'custom:Chat')!.options[1]).toEqual({ name: 'chat.post', label: `chat.post (${BLOCKED_ON_LOAD})`, disabled: true });
  });

  it('lists a tool once when it is given as both', () => {
    const groups = toolOptionGroups([chat], [chat]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.options).toEqual([{ name: 'chat.post', label: `chat.post (${BLOCKED_ON_LOAD})`, disabled: true }]);
  });
});
