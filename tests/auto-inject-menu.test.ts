// @vitest-environment jsdom
// The chat's ✨ menu (sidepanel/AutoInjectMenu): its rows grouped, and "Match by meaning" with the memory.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoInjectKind } from '../src/context/auto-inject';
import type { Settings } from '../src/storage/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ settings: undefined as unknown }));
const none: never[] = [];
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
vi.mock('../src/ui/Skills', () => ({ useSkills: () => none }));
vi.mock('../src/ui/templates/useTemplates', () => ({ useTemplates: () => none }));
vi.mock('../src/ui/settings-context', () => ({ useSettingsContext: () => ({ settings: state.settings, update: () => {} }) }));
vi.mock('../src/ui/open-options', () => ({ openOptions: async () => {} }));
vi.mock('../src/ui/Popover', () => ({
  Popover: ({ children, title }: { children: () => unknown; title: string }) => createElement('div', { 'data-title': title }, children() as never),
}));

const { AutoInjectMenu } = await import('../src/entrypoints/sidepanel/AutoInjectMenu');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const on = { providers: [provider], systemPrompt: '', memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed' }, autoAttach: { enabled: true, steps: true } }, bookmarks: { autoAttach: { enabled: true, steps: true } }, history: { autoAttach: { enabled: true } } } as unknown as Settings;

let container: HTMLDivElement;
function mount(settings: Settings, skip: AutoInjectKind[] = [], onSkip: (s: AutoInjectKind[]) => void = () => {}) {
  state.settings = settings;
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(createElement(AutoInjectMenu, { skip, onSkip })));
}
const lines = () => [...container.querySelectorAll('.menu-heading, .menu-check')].map((el) => (el.classList.contains('menu-heading') ? `# ${el.textContent}` : el.textContent!.split(' · ')[0]!));
const rowOf = (label: string) => [...container.querySelectorAll<HTMLLabelElement>('.menu-check')].find((l) => l.textContent!.startsWith(label))!;
const boxOf = (label: string) => rowOf(label).querySelector('input')!;

afterEach(() => container?.remove());

describe('the rows', () => {
  it('go under Memory, Site and Saved, each between-steps row under its own', () => {
    mount(on);
    expect(lines()).toEqual([
      '# In this conversation',
      '# Memory',
      'Site memory',
      'Matching memory',
      "Also between the model's steps",
      'Match by meaning',
      '# Site',
      'Site skills',
      'Site templates',
      '# Saved',
      'Saved conversations',
      'Bookmarks',
      "Also between the model's steps",
      '# Every conversation',
      'Page',
    ]);
  });

  it('leave how site memory goes out of the menu', () => {
    mount(on);
    expect(container.textContent).not.toContain('Only those that match');
  });
});

describe('Match by meaning', () => {
  it('says what it does, and is no sub-row of Matching memory', () => {
    mount(on);
    expect(rowOf('Match by meaning').textContent).toBe('Match by meaning · your message also goes to the embeddings provider');
    expect(rowOf('Match by meaning').classList.contains('sub')).toBe(false);
    expect(boxOf('Match by meaning').checked).toBe(true);
  });

  it('shows off in Settings with the global switch off', () => {
    mount({ ...on, memory: { ...on.memory, semantic: { enabled: false } } } as Settings);
    expect(boxOf('Match by meaning').disabled).toBe(true);
    expect(rowOf('Match by meaning').textContent).toBe('Match by meaning · off in Settings');
    expect(rowOf('Match by meaning').title).toBe('Off in Settings → Memory');
  });

  it('is left out of this conversation when unchecked, and the button says so', () => {
    const onSkip = vi.fn();
    mount(on, [], onSkip);
    act(() => boxOf('Match by meaning').click());
    expect(onSkip).toHaveBeenCalledWith(['memoryMeaning']);
    container.remove();
    mount(on, ['memoryMeaning']);
    expect(boxOf('Match by meaning').checked).toBe(false);
    expect(container.querySelector('[data-title]')!.getAttribute('data-title')).toContain('Match by meaning');
  });
});
