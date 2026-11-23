import { describe, expect, it } from 'vitest';
import { suggestionsFor, typingAt, type Kind } from '../src/entrypoints/sidepanel/composer/suggestions';
import { mentionOf } from '../src/markdown/user';
import { mentionsIn } from '../src/ui/chat/mentions';
import { agentMentionItem } from '../src/context/inline-mentions';
import { pieceLabel } from '../src/context/pieces';

const allOn: Record<Kind, boolean> = { template: true, skill: true, tool: true, agent: true, history: true, bookmark: true };
const agents = [{ name: 'Research Bot', description: 'Looks things up', icon: '🔎' }, { name: 'mm', description: '' }, { name: '🤖', description: '' }];
const sources = { templates: [], skills: [], tools: [], disabled: [], agents, conversations: [], bookmarks: [] };

describe('the @ list of the message box', () => {
  it('opens at the start of a word, not inside an email address, and not when switched off', () => {
    expect(typingAt('ask @re', allOn)).toMatchObject({ kind: 'agent', mention: '@re' });
    expect(typingAt('mail someone@exa', allOn)).toBeUndefined();
    expect(typingAt('ask @re', { ...allOn, agent: false })).toBeUndefined();
  });

  it('lists the agents that may be asked, filtered as you type, by name or slug', () => {
    const all = suggestionsFor(typingAt('@', allOn), sources);
    expect(all.map((s) => [s.label, s.detail, s.insert])).toEqual([['🔎 Research Bot', 'Looks things up', '@research-bot '], ['mm', '(no description)', '@mm ']]);
    expect(suggestionsFor(typingAt('@research-b', allOn), sources).map((s) => s.insert)).toEqual(['@research-bot ']);
    expect(suggestionsFor(typingAt('@bot', allOn), sources).map((s) => s.insert)).toEqual(['@research-bot ']); // a word of its name
    expect(suggestionsFor(typingAt('hi @Resea', allOn), sources).map((s) => s.insert)).toEqual(['@research-bot ']); // any case
  });
});

describe('a sent message', () => {
  it('shows a mentioned agent as a chip with its name', () => {
    const mentioned = mentionsIn([agentMentionItem(['Research Bot'])!.source])!;
    expect(mentionOf('@research-bot.', mentioned)).toEqual({ trigger: '@', name: 'research-bot', rest: '.' });
    expect(mentioned['@']!.get('research-bot')).toBe('Research Bot');
    expect(mentionOf('@Research-Bot', mentioned)).toEqual({ trigger: '@', name: 'research-bot', rest: '' }); // as typed by hand
    expect(mentionOf('@nobody', mentioned)).toBeUndefined();
  });

  it('names the note for the views', () => {
    const note = agentMentionItem(['Research Bot', 'mm'])!;
    expect(pieceLabel({ type: 'text', text: note.text, context: note.kind, source: note.source })).toBe('Agent mention @research-bot @mm');
  });
});
