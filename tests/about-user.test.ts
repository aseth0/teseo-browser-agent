import { afterEach, describe, expect, it } from 'vitest';
import { ABOUT_USER_VAR, fillAboutUser, usesAboutUser } from '../src/context/about-user';
import { buildSystemPrompt, systemPromptSections } from '../src/context/request';
import { setLimitOverrides } from '../src/core/limits';
import { text } from '../src/core/model-texts';
import type { Settings } from '../src/storage/settings';
import { compileBlacklist } from '../src/word-blacklist/core';
import { maskRequest } from '../src/word-blacklist/request';

const settings: Settings = { providers: [], systemPrompt: `Be brief. ${ABOUT_USER_VAR}`, aboutUser: 'I am Alex.', history: { enabled: false }, memory: { enabled: false } };
const agent = { id: 'a1', name: 'Writer', instructions: `Role. ${ABOUT_USER_VAR}` };

afterEach(() => setLimitOverrides(undefined));

describe('{{about_user}}', () => {
  it('is replaced at every place by the text, and by nothing without one', () => {
    expect(fillAboutUser('A {{about_user}} B {{about_user}}', 'Alex')).toBe('A Alex B Alex');
    expect(fillAboutUser('A {{about_user}} B', undefined)).toBe('A  B');
    expect(fillAboutUser('A {{about_user}} B', '  ')).toBe('A  B');
  });

  it('puts the text in as written, never expanded again', () => {
    expect(fillAboutUser('[{{about_user}}]', '{{about_user}} {instructions}')).toBe('[{{about_user}} {instructions}]');
  });

  it('cuts a text past the limit, with the marker', () => {
    setLimitOverrides({ aboutUser: 500 });
    const filled = fillAboutUser(ABOUT_USER_VAR, 'a'.repeat(500) + 'b'.repeat(100));
    expect(filled).toContain('a'.repeat(500));
    expect(filled).not.toContain('b');
    expect(filled).toContain(text('result.truncated'));
  });

  it('fills your system prompt', () => {
    const system = buildSystemPrompt({ settings, skills: [], templates: [] });
    expect(system.startsWith('Be brief. I am Alex.')).toBe(true);
    expect(system).not.toContain(ABOUT_USER_VAR);
  });

  it("fills an agent's instructions", () => {
    const agentPart = systemPromptSections({ settings: { ...settings, systemPrompt: 'x' }, skills: [], templates: [], agent }).find((s) => s.label === 'Agent');
    expect(agentPart?.text).toContain('Role. I am Alex.');
  });

  it("leaves out Browser's Agent part when its instructions are only the variable and there is no text", () => {
    const s: Settings = { ...settings, aboutUser: undefined, browserAgent: { instructions: ABOUT_USER_VAR } };
    expect(systemPromptSections({ settings: s, skills: [], templates: [] }).map((p) => p.label)).not.toContain('Agent');
  });

  it('reaches EmptyAgent through your system prompt', () => {
    const system = buildSystemPrompt({ settings, skills: [], templates: [], agent: { id: 'empty', name: 'EmptyAgent', instructions: '' } });
    expect(system).toBe('Be brief. I am Alex.');
  });

  it('is masked by the word blacklist like the rest of the system message', () => {
    const s = { ...settings, aboutUser: 'I work at Acme Labs.' };
    const bl = compileBlacklist([{ term: 'Acme Labs', replacement: 'CLIENT_A' }]);
    const masked = maskRequest({ system: buildSystemPrompt({ settings: s, skills: [], templates: [] }), messages: [] } as never, bl, { hideImages: false, systemNote: '', imageNote: '' });
    expect(masked.system).toContain('CLIENT_A');
    expect(masked.system).not.toContain('Acme Labs');
  });

  it('tells whether a prompt uses it', () => {
    expect(usesAboutUser(['x', undefined, `y ${ABOUT_USER_VAR}`])).toBe(true);
    expect(usesAboutUser(['x', undefined])).toBe(false);
  });
});
