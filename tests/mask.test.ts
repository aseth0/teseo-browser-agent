// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maskPage, unmaskPage } from '../src/content/mask';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const marked = (root: ParentNode = document) => [...root.querySelectorAll('[data-ba-mask]')].filter((e) => e.tagName !== 'STYLE');

describe('maskPage', () => {
  it('masks password, card and one-time-code fields', () => {
    document.body.innerHTML = '<input type="password"><input autocomplete="cc-number"><input autocomplete="one-time-code"><input id="plain">';
    expect(maskPage(document, []).count).toBe(3);
    expect(marked().map((e) => e.getAttribute('type') ?? e.getAttribute('autocomplete'))).toEqual(['password', 'cc-number', 'one-time-code']);
    expect(document.head.querySelector('style[data-ba-mask]')).not.toBeNull();
  });

  it('masks fields named like secrets', () => {
    document.body.innerHTML = '<input name="api_key"><textarea id="session-token"></textarea><input name="city">';
    expect(maskPage(document, []).count).toBe(2);
  });

  it('masks extra selectors and skips an invalid one', () => {
    document.body.innerHTML = '<div class="card">4111</div><span>x</span>';
    expect(maskPage(document, ['.card', '[[bad']).count).toBe(1);
  });

  it('masks a password inside an open shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<input type="password">';
    expect(maskPage(document, []).count).toBe(1);
    expect(shadow.querySelector('style[data-ba-mask]')).not.toBeNull();
    expect(marked(shadow)).toHaveLength(1);
  });

  it('boxes a cross-origin iframe', () => {
    document.body.innerHTML = '<iframe id="pay" src="https://pay.example.test/"></iframe><iframe id="same" src="about:blank"></iframe>';
    maskPage(document, []);
    expect(marked().map((e) => e.id)).toEqual(['pay']);
  });
});

describe('maskPage, later fields', () => {
  it('masks the fields by selector too, so one rendered later is painted over', () => {
    document.body.innerHTML = '<input id="x">';
    maskPage(document, ['.card']);
    const css = document.head.querySelector('style[data-ba-mask]')!.textContent!;
    expect(css).toContain('input[type=password]');
    expect(css).toContain('.card');
  });

  it('masks a password inside a same-origin iframe', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>';
    const inner = (document.getElementById('f') as HTMLIFrameElement).contentDocument!;
    inner.body.innerHTML = '<input type="password">';
    expect(maskPage(document, []).count).toBe(1);
    expect(inner.querySelector('style[data-ba-mask]')).not.toBeNull();
    expect(marked(inner)).toHaveLength(1);
  });
});

describe('unmaskPage', () => {
  it('reports false when a sensitive field appeared unmasked', () => {
    document.body.innerHTML = '<input type="password">';
    const { token } = maskPage(document, []);
    document.body.insertAdjacentHTML('beforeend', '<input name="session_token">');
    expect(unmaskPage(document, token)).toBe(false);
  });

  it('cleans a same-origin iframe too', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>';
    const inner = (document.getElementById('f') as HTMLIFrameElement).contentDocument!;
    inner.body.innerHTML = '<input type="password">';
    const { token } = maskPage(document, []);
    expect(unmaskPage(document, token)).toBe(true);
    expect(inner.querySelectorAll('[data-ba-mask]')).toHaveLength(0);
  });

  it('removes everything and reports the mask was there', () => {
    document.body.innerHTML = '<input type="password">';
    const { token } = maskPage(document, []);
    expect(unmaskPage(document, token)).toBe(true);
    expect(document.querySelectorAll('[data-ba-mask]')).toHaveLength(0);
  });

  it('reports false when the style is gone', () => {
    document.body.innerHTML = '<input type="password">';
    const { token } = maskPage(document, []);
    document.head.innerHTML = '';
    expect(unmaskPage(document, token)).toBe(false);
  });
});

describe('remaskPage', () => {
  it('marks what appeared after masking, and counts it', async () => {
    const { remaskPage } = await import('../src/content/mask');
    document.body.innerHTML = '<input type="password">';
    const { token } = maskPage(document, []);
    document.body.insertAdjacentHTML('beforeend', '<input name="api_key">');
    expect(remaskPage(document, token, [])).toBe(1);
    expect(unmaskPage(document, token)).toBe(true);
  });
});

describe('a mask never taken away', () => {
  it('takes itself away after a while, and the capture is then not taken as masked', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<input type="password">';
      const { token } = maskPage(document, []);
      vi.advanceTimersByTime(29_000);
      expect(marked()).toHaveLength(1);
      vi.advanceTimersByTime(1_000);
      expect(marked()).toHaveLength(0);
      expect(document.querySelector('style[data-ba-mask]')).toBeNull();
      expect(unmaskPage(document, token)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a mask taken away in time leaves no timer behind', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<input type="password">';
      const { token } = maskPage(document, []);
      expect(unmaskPage(document, token)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
