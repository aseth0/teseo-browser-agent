import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { exportActions, importActions } = await import('../src/widget/io');
const { newAction } = await import('../src/widget/actions');
const { newAgentProfile } = await import('../src/agents/profiles');

const jira = { ...newAgentProfile(), id: 'j1', name: 'Jira' };
const translate = { ...newAction(), id: 'a1', name: 'Translate', tool: '', prompt: 'Translate: {input}', providerId: 'p1', model: 'm', thinking: 'high' as const, agent: 'j1', outputs: [{ label: 'Spanish' }] };

describe('actions as JSON', () => {
  it('exports them without ids, their agent by name', () => {
    const out = JSON.parse(exportActions([translate], [jira]));
    expect(out.actions).toEqual([{ name: 'Translate', where: [], input: 'text', tool: '', args: {}, outputs: [{ label: 'Spanish' }], prompt: 'Translate: {input}', providerId: 'p1', model: 'm', thinking: 'high', agent: 'Jira' }]);
  });
  it('imports them off, replacing the one of their name, its agent and model only when here', () => {
    const json = exportActions([translate], [jira]);
    const other = { ...jira, id: 'j2' };
    const { actions, skipped } = importActions(json, [{ ...translate, id: 'mine' }], [other], ['p1']);
    expect(skipped).toEqual([]);
    expect(actions[0]).toMatchObject({ id: 'mine', enabled: false, agent: 'j2', providerId: 'p1', model: 'm', thinking: 'high' });
    expect(importActions(json, [], [other], [])).toMatchObject({ actions: [{ name: 'Translate' }] });
    expect(importActions(json, [], [other], []).actions[0]).not.toHaveProperty('providerId');
  });
  it('replaces the one of its name in any case, and leaves out one whose agent is not here', () => {
    const json = exportActions([translate], [jira]);
    expect(importActions(json, [{ ...translate, id: 'mine', name: ' translate ' }], [jira], []).actions[0]).toMatchObject({ id: 'mine', name: 'Translate' });
    expect(importActions(json, [], [], []).skipped).toEqual(['Translate: no agent named "Jira" here.']);
  });
  it('keeps when it runs and the values it reads from the page', () => {
    const load = { ...newAction(), id: 'l', name: 'Stats', input: 'none' as const, when: 'load' as const, reads: { id: '{{meta:octolytics-dimension-repository_id}}' }, tool: 'github.repo', args: { id: '{id}' } };
    const [back] = importActions(exportActions([load], []), [], [], []).actions;
    expect(back).toMatchObject({ when: 'load', reads: { id: '{{meta:octolytics-dimension-repository_id}}' }, args: { id: '{id}' } });
    const ask = { ...newAction(), id: 'c', name: 'Ask', tool: '', openChat: true, prompt: 'Summarize this article' };
    expect(importActions(exportActions([ask], []), [], [], []).actions[0]).toMatchObject({ openChat: true, prompt: 'Summarize this article' });
  });
  it('keeps how its boxes are read aloud, and drops what is not a voice or a when', () => {
    const read = { ...newAction(), id: 'r', name: 'Read', tool: 't', outputs: [{ label: 'R' }], speak: { profileId: 'v1', when: 'shown' as const } };
    expect(importActions(exportActions([read], []), [], [], []).actions[0]).toMatchObject({ speak: { profileId: 'v1', when: 'shown' } });
    const odd = JSON.stringify([{ name: 'Odd', tool: 't', outputs: [{ label: 'R' }], speak: { profileId: 3, when: 'always' } }]);
    expect(importActions(odd, [], [], []).actions[0]).not.toHaveProperty('speak');
  });
  it('keeps whether it shows beside selected text, only as true', () => {
    const beside = { ...newAction(), id: 'b', name: 'Beside', tool: 't', outputs: [{ label: 'R' }], besideSelection: true as const };
    expect(JSON.parse(exportActions([beside], [])).actions[0]).toMatchObject({ besideSelection: true });
    expect(importActions(exportActions([beside], []), [], [], []).actions[0]).toMatchObject({ besideSelection: true });
    const odd = JSON.stringify([{ name: 'Odd', tool: 't', outputs: [{ label: 'R' }], besideSelection: 'yes' }]);
    expect(importActions(odd, [], [], []).actions[0]).not.toHaveProperty('besideSelection');
    // On an action that takes nothing: left out, with why.
    const none = JSON.stringify([{ name: 'None', tool: 't', input: 'none', outputs: [{ label: 'R' }], besideSelection: true }]);
    expect(importActions(none, [], [], []).skipped[0]).toMatch(/shows beside selected text/);
  });
  it('leaves out what cannot be saved, or names an agent that is not here', () => {
    const { actions, skipped } = importActions(JSON.stringify([{ name: 'X', tool: 't', agent: 'Ghost', outputs: [{ label: 'R' }] }, { name: '', tool: '' }]), [], [], []);
    expect(actions).toEqual([]);
    expect(skipped[0]).toMatch(/^X: no agent named "Ghost" here\./);
    expect(skipped[1]).toMatch(/^\(no name\): /);
  });
});
