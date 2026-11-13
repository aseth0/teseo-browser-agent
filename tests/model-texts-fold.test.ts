// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEXT_DEFS, type TextId } from '../src/core/model-texts';
import type { Settings } from '../src/storage/settings';
import { ModelTextsFold } from '../src/ui/PageModelTexts';
import { SettingsContext } from '../src/ui/settings-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
const show = async (node: ReactNode) => {
  host = document.createElement('div');
  document.body.append(host);
  await act(async () => createRoot(host).render(h(SettingsContext.Provider, { value: { settings: {} as Settings, update: vi.fn(), save: vi.fn() } }, node)));
};
const fold = () => host.querySelector('details');
afterEach(() => host.remove());

const IDS: TextId[] = ['tools.load_description', 'result.tools_loaded'];
const props = { when: 'always', hint: 'What it is' };

describe('ModelTextsFold', () => {
  it('shows nothing without texts', async () => {
    await show(h(ModelTextsFold, { ...props, ids: [] }));
    expect(fold()).toBeNull();
  });

  it('comes folded, with how many texts and an editor for each', async () => {
    await show(h(ModelTextsFold, { ...props, ids: IDS }));
    expect(fold()!.open).toBe(false);
    expect(fold()!.className).toContain('model-texts-fold');
    expect(host.querySelector('summary')!.textContent).toContain('2 texts');
    expect(host.querySelector('.hint')!.textContent).toBe('What it is');
    for (const id of IDS) expect(fold()!.textContent).toContain(TEXT_DEFS[id].label);
  });

  it('says one text in the singular', async () => {
    await show(h(ModelTextsFold, { ...props, ids: IDS.slice(0, 1) }));
    expect(host.querySelector('summary')!.textContent).toContain('1 text');
    expect(host.querySelector('summary')!.textContent).not.toContain('1 texts');
  });

  it('opens for a link to it, by its id', async () => {
    await show(h(ModelTextsFold, { ...props, ids: IDS, id: 'tool-tools.load', open: true }));
    expect(document.getElementById('tool-tools.load')).toBe(fold());
    expect(fold()!.open).toBe(true);
  });
});
