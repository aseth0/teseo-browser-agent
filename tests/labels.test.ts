import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { kindsOf, labelColor, labelName, matches } = await import('../src/tools/labels');

const tool = (change: object) => ({ id: 'x', enabled: true, name: 'a.b', description: '', base: 'web.search', params: {}, ...change });

describe('custom tool labels', () => {
  it('are written one way, each with its color: the picked one, else always the same of its name', () => {
    expect(labelName('  My Team  ')).toBe('my-team');
    expect(labelColor('mattermost', {})).toBe(labelColor('mattermost', {}));
    expect(labelColor('mattermost', {})).not.toBe('gray');
    expect(labelColor('mattermost', { mattermost: 'gray' })).toBe('gray');
  });

  it('tell the kind of a tool, and filter by every one picked', () => {
    const script = tool({ base: 'script', createdBy: 'model', labels: ['mattermost'] });
    const http = tool({ base: 'http', labels: ['mattermost', 'jira'] });
    expect(kindsOf(script)).toEqual(['script', 'model']);
    expect(kindsOf(http)).toEqual(['http']);
    expect(kindsOf(tool({}))).toEqual(['derived']);
    expect(matches(script, { kinds: [], labels: [] })).toBe(true);
    expect(matches(script, { kinds: ['model'], labels: ['mattermost'] })).toBe(true);
    expect(matches(http, { kinds: [], labels: ['mattermost', 'jira'] })).toBe(true);
    expect(matches(script, { kinds: [], labels: ['mattermost', 'jira'] })).toBe(false);
    expect(matches(http, { kinds: ['script'], labels: [] })).toBe(false);
  });
});
