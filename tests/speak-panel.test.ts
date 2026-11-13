// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import type { Settings } from '../src/storage/settings-types';

// The side panel's speak buttons: under each answer (beside Copy) and beside the selection chip, read with
// the voice of the agent the text is of, Stop while that text is read; and an answer's Markdown as said.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ started: true }));
const contains = vi.fn(async (_p: unknown) => true);
vi.mock('wxt/browser', () => ({ browser: { offscreen: {}, runtime: { sendMessage }, permissions: { contains, request: vi.fn(async () => true) } } }));
vi.mock('../src/ui/Markdown', () => ({ Markdown: ({ text }: { text: string }) => createElement('div', null, text) }));
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [] }));
let speaking: unknown;
vi.mock('../src/ui/useSpeakStatus', () => ({ useSpeakStatus: () => speaking }));
const { ChatHistory } = await import('../src/ui/ChatMessages');
const { ChatActionsContext } = await import('../src/ui/chat/contexts');
const { useSpeakButtons } = await import('../src/entrypoints/sidepanel/useSpeakButtons');
const { SelectionChip } = await import('../src/entrypoints/sidepanel/SelectionChip');
const { speakable } = await import('../src/speech/markdown');
const { newAgentProfile } = await import('../src/agents/profiles');

const providers = [
  { id: 'p', name: 'P', baseURL: 'https://tts.example.test/v1', apiKey: '', defaultModel: '' },
  { id: 'q', name: 'Q', baseURL: 'https://voices.example.test/v1', apiKey: '', defaultModel: '' },
];
const speak = { profiles: [{ id: 'a', name: 'Calm', providerId: 'p', model: 'm', voice: 'nova_a' }, { id: 'b', name: 'Other', providerId: 'q', model: 'm', voice: 'nova_b' }] };
const reader = { ...newAgentProfile(), id: 'reader', name: 'reader', voiceProfileId: 'b' };

// The chat's history and the selection chip, with the panel's speak buttons.
function Panel({ settings, history }: { settings: Settings; history: Message[] }) {
  const buttons = useSpeakButtons(settings, [reader], 4);
  return createElement(ChatActionsContext.Provider, { value: { busy: false, speak: buttons } },
    createElement(ChatHistory, { history, results: new Map(), running: false, format: 'markdown' }),
    createElement(SelectionChip, { selection: { text: 'Picked words.', truncated: false }, off: false, onToggle: () => undefined, speak: buttons, agentId: 'reader' }));
}
async function show(settings: Settings, history: Message[]) {
  const box = document.createElement('div');
  await act(async () => createRoot(box).render(createElement(Panel, { settings, history })));
  const named = (label: string) => box.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { box, named };
}
const history: Message[] = [
  { role: 'user', parts: [{ type: 'text', text: 'Hi' }], agent: 'reader' } as Message,
  { role: 'assistant', parts: [{ type: 'text', text: '## Plan\n- **First**, read [the page](https://example.test).\n\n```js\nx()\n```' }] },
];
const base = (more: Partial<Settings> = {}) => ({ providers, systemPrompt: '', speak, ...more }) as Settings;

describe('the side panel\'s speak buttons', () => {
  it('an answer is read with the voice of the agent that gave it, its pill on the panel\'s tab', async () => {
    const { named } = await show(base(), history);
    sendMessage.mockClear();
    await act(async () => named('Read the answer aloud')!.click());
    expect(contains).toHaveBeenLastCalledWith({ origins: ['https://voices.example.test/*'] }); // the agent's profile's provider
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'browser-agent:speak-text', text: 'Plan.\nFirst, read the page.', agentId: 'reader', tabId: 4 }));
  });

  it('the selection, with the active agent\'s voice', async () => {
    const { named } = await show(base(), history);
    sendMessage.mockClear();
    await act(async () => named('Read the selected text aloud')!.click());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-text', text: 'Picked words.', agentId: 'reader', tabId: 4, key: 'selection' });
  });

  it('Stop while that text is read', async () => {
    speaking = { run: 'r', state: 'reading', piece: 1, total: 2, startedAt: 1, key: 'selection' };
    const { named } = await show(base(), history);
    expect(named('Read the answer aloud')).not.toBeNull();
    sendMessage.mockClear();
    await act(async () => named('Stop reading aloud')!.click());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-stop' });
    speaking = undefined;
  });

  it('none while Speak is off, or has no profile and no system voice', async () => {
    expect((await show(base({ speak: { ...speak, enabled: false } }), history)).named('Read the answer aloud')).toBeNull();
    expect((await show(base({ speak: { systemVoice: false } }), history)).named('Read the selected text aloud')).toBeNull();
  });
});

describe('an answer as it is said', () => {
  it('without its Markdown marks, code blocks nor images', () => {
    expect(speakable('# Title\n\n> quoted *word* and `code`\n\n1. one\n2. two\n\n![img](x.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe('Title.\n\nquoted word and code\n\none\ntwo\n\na, b\n\n1, 2');
    expect(speakable('snake_case_name stays, ~~gone~~ struck')).toBe('snake_case_name stays, gone struck');
  });
});
