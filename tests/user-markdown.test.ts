// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { MessageView } from '../src/ui/chat/MessageView';
import type { Message } from '../src/core/types';
import type { TextFormat } from '../src/storage/settings-types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A user message with $browser.find, /summarize-page and ::todoist/today attached.
const message = (text: string): Message => ({
  role: 'user',
  parts: [
    { type: 'text', text },
    { type: 'text', text: '', context: 'tool', source: 'tool-mention:browser.find' },
    { type: 'text', text: '', context: 'skill', source: 'skill-mention:summarize-page' },
    { type: 'text', text: '', context: 'page', source: 'mention:todoist/today' },
  ],
} as Message);

async function render(text: string, format: TextFormat = 'markdown'): Promise<HTMLElement> {
  const el = document.createElement('div');
  await act(async () => createRoot(el).render(createElement(MessageView, { message: message(text), results: new Map(), running: false, format, chips: false })));
  return el.querySelector<HTMLElement>('.msg.user')!;
}

describe('your messages as Markdown', () => {
  it('renders Markdown marks', async () => {
    const msg = await render('**bold** and `code`');
    expect(msg.querySelector('strong')?.textContent).toBe('bold');
    expect(msg.querySelector('code')?.textContent).toBe('code');
  });

  it('keeps raw HTML out', async () => {
    const msg = await render('<b>x</b> y');
    expect(msg.querySelector('b')).toBeNull();
  });

  it('keeps a single line break', async () => {
    const msg = await render('line one\nline two');
    expect(msg.querySelectorAll('br')).toHaveLength(1);
    expect(msg.textContent).toContain('line one');
    expect(msg.textContent).toContain('line two');
  });

  it('shows mentions as chips, after Markdown marks too', async () => {
    const msg = await render('**$browser.find** then /summarize-page.');
    const chips = [...msg.querySelectorAll('.mention')].map((c) => c.textContent?.trim());
    expect(chips).toEqual(['browser.find', 'summarize-page']);
    expect(msg.textContent?.trim().endsWith('.')).toBe(true);
  });

  it('shows a chip for a mention alone, and a site view', async () => {
    expect((await render('::todoist/today')).querySelectorAll('.mention')).toHaveLength(1);
    expect((await render('$browser.find.')).textContent?.trim().endsWith('.')).toBe(true);
  });

  it('leaves a mention glued to code, bold text or a link as text', async () => {
    expect((await render('`x`$browser.find')).querySelector('.mention')).toBeNull();
    expect((await render('foo**bar**/summarize-page')).querySelector('.mention')).toBeNull();
    expect((await render('[link](https://example.com)/summarize-page')).querySelector('.mention')).toBeNull();
    expect((await render('\\$browser.find escaped')).querySelector('.mention')).toBeNull();
  });

  it('leaves mentions in code as text', async () => {
    expect((await render('`$browser.find`')).querySelector('.mention')).toBeNull();
    expect((await render('```\n$browser.find\n```')).querySelector('.mention')).toBeNull();
  });

  it('leaves a mention-like word mid-word alone', async () => {
    expect((await render('std::todoist/today and a/summarize-page')).querySelector('.mention')).toBeNull();
  });

  it('shows the text as written in the plain format, chips included', async () => {
    const msg = await render('**bold** $browser.find', 'plain');
    expect(msg.querySelector('strong')).toBeNull();
    expect(msg.textContent).toContain('**bold**');
    expect(msg.querySelectorAll('.mention')).toHaveLength(1);
  });
});
