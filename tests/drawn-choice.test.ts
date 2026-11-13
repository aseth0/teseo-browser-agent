// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import { DrawnChoice } from '../src/ui/DrawnChoice';
import { BubbleSection } from '../src/ui/bubble/BubbleSettings';
import { StepsShow } from '../src/ui/widget-actions/Steps';

vi.mock('../src/ui/SectionTop', () => ({ SectionTop: () => null }));
vi.mock('../src/ui/bubble/BubblePreview', () => ({ BubblePreview: () => null }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => false, onAdded: { addListener: () => {}, removeListener: () => {} }, onRemoved: { addListener: () => {}, removeListener: () => {} } }, commands: { getAll: async () => [] }, storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {}, removeListener: () => {} } } } }));

// A choice as radio buttons over drawings; and the settings that use it, with the values they stored as selects.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(element: React.ReactElement) {
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => createRoot(root).render(element));
  return root;
}
const radiosOf = (group: Element) => [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const named = (radio: HTMLInputElement) => radio.closest('.drawn-option-name')!.textContent;
const OPTIONS = [
  { id: 'a', label: 'First', drawing: createElement('circle', { r: 1 }) },
  { id: 'b', label: 'Second', drawing: createElement('circle', { r: 2 }) },
];

describe('DrawnChoice', () => {
  const choice = (props = {}) => {
    const onChange = vi.fn();
    return { onChange, shown: render(createElement(DrawnChoice<string>, { legend: 'Which', name: 'which', viewBox: '0 0 10 10', options: OPTIONS, value: 'b', onChange, ...props })) };
  };

  it('offers the options in one group under its legend, the value chosen', async () => {
    const root = await choice().shown;
    const radios = radiosOf(root);
    expect(radios.map(named)).toEqual(['First', 'Second']);
    expect(radios.map((r) => r.name)).toEqual(['which', 'which']);
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
    expect(root.querySelector('fieldset legend')!.textContent).toBe('Which');
  });

  it("says each option's id when chosen, and nothing for the one chosen already", async () => {
    const { onChange, shown } = choice();
    const radios = radiosOf(await shown);
    await act(async () => radios[1]!.click());
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => radios[0]!.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('draws each on the viewBox, out of what a screen reader says', async () => {
    const drawings = [...(await choice().shown).querySelectorAll('.drawn-option svg')];
    expect(drawings.map((d) => d.querySelector('circle')!.getAttribute('r'))).toEqual(['1', '2']);
    expect(drawings.every((d) => d.getAttribute('aria-hidden') === 'true' && d.getAttribute('viewBox') === '0 0 10 10')).toBe(true);
  });

  it('has no legend where the group around it says what it chooses, and a size if asked', async () => {
    const root = await choice({ legend: undefined, size: 'small' }).shown;
    expect(root.querySelector('legend')).toBeNull();
    expect(root.querySelector('fieldset')!.className).toBe('drawn-choice small');
  });
});

describe('where the page widget opens the chat', () => {
  async function open(chatWindow?: Settings['chatWindow']) {
    const onChange = vi.fn();
    const root = await render(createElement(BubbleSection, { settings: { providers: [], chatWindow } as unknown as Settings, onChange }));
    // Its own tab of Settings → Bubble.
    await act(async () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Opening the chat')!.click());
    const group = (legend: RegExp) => radiosOf([...root.querySelectorAll('fieldset')].find((f) => legend.test(f.querySelector(':scope > legend')?.textContent ?? ''))!);
    return { onChange, root, opens: group(/^Its bubble, its actions/), side: group(/^Side$/), height: group(/^Height$/) };
  }
  const heightInput = (root: Element) => [...root.querySelectorAll('label')].find((l) => l.textContent.startsWith('Height, px'));

  it('starts in the side panel, at the right, at a fixed height', async () => {
    const { opens, side, height, root } = await open();
    expect(opens.map(named)).toEqual(['In the side panel', 'Floating on the page']);
    expect(side.map(named)).toEqual(['Right', 'Left']);
    expect(height.map(named)).toEqual(['Fixed', 'Whole window']);
    expect([opens, side, height].map((g) => g[0]!.checked)).toEqual([true, true, true]);
    expect(heightInput(root)).toBeDefined();
  });

  it('stores what was stored with the selects', async () => {
    const { onChange, opens, side, height } = await open({ width: 420 });
    await act(async () => opens[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ chatWindow: { width: 420, opens: 'floating' } });
    await act(async () => side[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ chatWindow: { width: 420, side: 'left' } });
    await act(async () => height[1]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ chatWindow: { width: 420, height: 'full' } });
  });

  it('asks for the height in px only when fixed, and going back to fixed forgets the whole window', async () => {
    const { onChange, height, root } = await open({ height: 'full' });
    expect(height.map((r) => r.checked)).toEqual([false, true]);
    expect(heightInput(root)).toBeUndefined();
    await act(async () => height[0]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ chatWindow: { height: undefined } });
  });

  it('keeps a number of px as Fixed', async () => {
    const { height, root } = await open({ height: 700 });
    expect(height.map((r) => r.checked)).toEqual([true, false]);
    expect(heightInput(root)!.querySelector('input')!.value).toBe('700');
  });
});

describe('while the bubble works', () => {
  async function open(bubbleThinking?: 'pulse') {
    const onChange = vi.fn();
    const root = await render(createElement(BubbleSection, { settings: { providers: [], appearance: { bubbleThinking } } as unknown as Settings, onChange }));
    const radios = radiosOf([...root.querySelectorAll('fieldset')].find((f) => f.querySelector(':scope > legend')?.textContent === 'While it works')!);
    return { onChange, radios };
  }
  it('offers the five, the ring with nothing stored, and stores none for it', async () => {
    const { radios } = await open();
    expect(radios.map(named)).toEqual(['Ring', 'Pulse', 'Thought bubble', 'The face thinks', 'None']);
    expect(radios[0]!.checked).toBe(true);
    const again = await open('pulse');
    expect(again.radios[1]!.checked).toBe(true);
    await act(async () => again.radios[0]!.click());
    const change = again.onChange.mock.lastCall![0] as (s: Settings) => Settings;
    expect(change({ appearance: { bubbleThinking: 'pulse' } } as unknown as Settings).appearance!.bubbleThinking).toBeUndefined();
  });
});

describe('what an action with steps shows', () => {
  const steps = [{ name: 'triage', prompt: 'Triage', fields: { priority: 'text' } }];
  async function open(action: object) {
    const onChange = vi.fn();
    const root = await render(createElement(StepsShow, { action: { steps, outputs: [], ...action } as never, onChange }));
    return { onChange, radios: radiosOf(root), root };
  }
  it('offers the three, under the one legend of its block', async () => {
    const { radios, root } = await open({ outputs: [{ label: 'A' }, { label: 'B' }] });
    expect(radios.map(named)).toEqual(['Fields in the card', 'A text in the card', 'Only a badge on the bubble']);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
    expect([...root.querySelectorAll('legend')].map((l) => l.textContent)).toEqual(['What it shows']);
  });
  it('changes what it stores as before', async () => {
    const { onChange, radios } = await open({ outputs: [{ label: 'Result', from: 'triage' }] });
    await act(async () => radios[2]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ outputs: [], badge: 'triage.priority' });
    await act(async () => radios[0]!.click());
    expect(onChange).toHaveBeenLastCalledWith({ outputs: [{ label: 'Priority', from: 'triage.priority' }] });
  });
});
