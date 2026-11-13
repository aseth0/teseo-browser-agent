// @vitest-environment jsdom
// browser.click's watch on the page (content/change): whether the click changed what the page shows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endChange, startChange } from '../src/content/change';
import { WIDGET_TAG } from '../src/page/protocol';

// jsdom gives a frame its new document the moment its src is set (a browser, once it loaded): a test hands
// the watch the document that came later.
let lateFrameDocument: Document | undefined;
vi.mock('../src/content/dom-tree', async (orig) => {
  const real = await orig<typeof import('../src/content/dom-tree')>();
  return { ...real, frameDocument: (el: Element) => (el.tagName === 'IFRAME' && lateFrameDocument) || real.frameDocument(el) };
});

const $ = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  lateFrameDocument = undefined;
  history.replaceState({}, '', '/rail');
  document.body.innerHTML = `<div role="tree"><div role="treeitem" id="item" tabindex="-1"><img id="icon" alt=""></div><div role="treeitem" id="other" tabindex="0"></div></div>
    <input id="field"><label id="label"><input type="checkbox" id="box"> Remember</label><select id="pick"><option>A</option></select><p id="status">idle</p>`;
  (document.activeElement as HTMLElement | null)?.blur();
});

// The watch around what a click did.
const watched = (el: Element, click: () => void) => {
  const token = startChange(el)!;
  click();
  return endChange(token);
};

// A layer the page adds, holding this.
const added = (html: string) => {
  const layer = document.createElement('div');
  layer.innerHTML = html;
  document.body.append(layer);
  return layer;
};

// The same, with the page's own handler on the click event.
const onClick = (el: Element, handler: () => void) => {
  el.addEventListener('click', handler);
  return watched(el, () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

describe('a click that changed nothing', () => {
  it('is told: the same address, the same DOM, the focus on the element clicked', () => {
    expect(watched($('item'), () => $('item').focus())).toBe(false);
  });

  it('nor when only the tabindex moved along with the focus', () => {
    expect(
      watched($('item'), () => {
        $('item').setAttribute('tabindex', '0');
        $('other').setAttribute('tabindex', '-1');
      }),
    ).toBe(false);
  });

  it('nor when only our own widget changed', () => {
    const host = document.createElement(WIDGET_TAG);
    document.body.append(host);
    expect(
      watched($('item'), () => {
        host.style.setProperty('pointer-events', 'none');
        host.append(document.createElement('div'));
        document.body.append(document.createElement(WIDGET_TAG));
      }),
    ).toBe(false);
  });
});

describe('a click that only showed what hovering or focusing the element shows', () => {
  it('a tooltip shown, then moved into place and hidden', () => {
    const token = startChange($('item'))!;
    const shown = added('<div role="tooltip"><span>Example Space</span></div>');
    expect(endChange(token)).toBe(false);
    expect(
      watched($('item'), () => {
        shown.firstElementChild!.setAttribute('style', 'left: 80px');
        shown.querySelector('span')!.textContent = 'Example';
        shown.remove();
      }),
    ).toBe(false);
  });

  it('a tooltip in layers that only hold it', () => {
    expect(watched($('item'), () => added('<div class="layer"><div><div role="tooltip">Example Space</div></div></div>'))).toBe(false);
  });

  it('what the element points to with aria-describedby, tooltip or not', () => {
    expect(
      watched($('item'), () => {
        $('item').setAttribute('aria-describedby', 'hint');
        added('<div id="hint">Example Space</div>');
      }),
    ).toBe(false);
  });

  it('what the element points to with aria-labelledby', () => {
    expect(
      watched($('item'), () => {
        $('item').setAttribute('aria-labelledby', 'hint');
        added('<div id="hint">Example Space</div>');
      }),
    ).toBe(false);
  });

  it('what a parent of the element points to', () => {
    $('item').parentElement!.setAttribute('aria-describedby', 'hint');
    expect(watched($('item'), () => added('<div id="hint">Example Space</div>'))).toBe(false);
  });

  it('a layer around a tooltip, moved into place', () => {
    const token = startChange($('item'))!;
    const layer = added('<div><div role="tooltip">Example Space</div></div>');
    layer.setAttribute('style', 'left: 80px');
    layer.firstElementChild!.setAttribute('style', 'top: 8px');
    expect(endChange(token)).toBe(false);
  });

  it('a tooltip with its arrow', () => {
    expect(watched($('item'), () => added('<div role="tooltip">Example Space</div><div class="arrow"><svg></svg></div>'))).toBe(false);
  });

  it('a tooltip shown as text, with a hidden copy for screen readers', () => {
    expect(watched($('item'), () => added('<div>Example Space<span role="tooltip">Example Space</span></div>'))).toBe(false);
  });

  it('a tooltip in the place of a framework\'s comment', () => {
    const placeholder = document.createComment('');
    document.body.append(placeholder);
    expect(
      watched($('item'), () => {
        placeholder.remove();
        document.body.append(document.createTextNode('\n'));
        added('<div role="tooltip">Example Space</div>');
      }),
    ).toBe(false);
  });

  it('a tooltip hidden again, removed from a layer that stays', () => {
    const layer = added('<div role="tooltip">Example Space</div>');
    expect(watched($('item'), () => layer.firstElementChild!.remove())).toBe(false);
  });

  it('inside an open shadow root: the focus on the element, the look of the element\'s host', () => {
    const root = $('status').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="inner">Open</button>';
    const inner = root.getElementById('inner')!;
    expect(
      watched(inner, () => {
        inner.focus();
        $('status').classList.add('lit');
      }),
    ).toBe(false);
  });

  it('the focus on something the element holds', () => {
    $('item').insertAdjacentHTML('beforeend', '<button id="inside">Open</button>');
    expect(watched($('item'), () => $('inside').focus())).toBe(false);
  });

  it('the look it got before the click event, and a tooltip the handler shows', () => {
    const token = startChange($('item'))!;
    $('item').classList.add('hovered');
    $('item').addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', '<div role="tooltip">Hint</div>'));
    $('item').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(endChange(token)).toBe(false);
  });

  it('a tooltip in a shadow root attached since the watch began', () => {
    expect(
      watched($('item'), () => {
        const root = $('status').attachShadow({ mode: 'open' });
        root.innerHTML = '<div role="tooltip">Example Space</div>';
      }),
    ).toBe(false);
  });

  it('a tooltip in a wrapper that is only there for its role', () => {
    expect(watched($('item'), () => added('<div role="presentation"><div role="tooltip">Example Space</div></div>'))).toBe(false);
  });

  it('the look of the element, of what holds it and of what it holds', () => {
    expect(
      watched($('item'), () => {
        $('item').classList.add('hovered');
        $('item').dataset.focused = 'true';
        $('item').parentElement!.setAttribute('style', 'opacity: 0.9');
        document.body.classList.add('keyboard');
        $('icon').classList.add('lit');
      }),
    ).toBe(false);
  });
});

describe('a click that changed something', () => {
  it.each(['aria-expanded', 'aria-selected', 'aria-pressed', 'aria-checked'])('%s on the element clicked', (name) => {
    expect(watched($('item'), () => $('item').setAttribute(name, 'true'))).toBe(true);
  });

  it.each(['<div role="menu"><div role="menuitem">Open</div></div>', '<div role="dialog">Sure?</div>', '<div role="tooltip">Hint</div><p>More</p>'])('%s opened', (html) => {
    expect(watched($('item'), () => added(html))).toBe(true);
  });

  it('aria-current on the element clicked', () => {
    expect(watched($('item'), () => $('item').setAttribute('aria-current', 'page'))).toBe(true);
  });

  it('a toggle: the look of the element, from the page\'s handler on the click', () => {
    expect(onClick($('item'), () => $('item').classList.toggle('on'))).toBe(true);
  });

  it('a menu shown by a class on what holds the element, from the handler on the click', () => {
    expect(onClick($('item'), () => $('item').parentElement!.classList.add('open'))).toBe(true);
  });

  it('the same, from a handler that updates a moment later', async () => {
    const token = startChange($('item'))!;
    $('item').addEventListener('click', () => void Promise.resolve().then(() => $('item').parentElement!.classList.add('open')));
    $('item').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    expect(endChange(token)).toBe(true);
  });

  it('a toggle that first asks the server: the look of the element, from the handler a while later', async () => {
    const token = startChange($('item'))!;
    $('item').addEventListener('click', () => {
      setTimeout(() => {
        $('item').classList.add('active');
        $('item').dataset.state = 'on';
      }, 5);
    });
    $('item').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(endChange(token)).toBe(true);
  });

  it('what the element points to, there from before: a status it is described by', () => {
    $('item').setAttribute('aria-describedby', 'status');
    expect(watched($('item'), () => ($('status').textContent = 'saved'))).toBe(true);
    $('status').remove();
    document.body.insertAdjacentHTML('beforeend', '<p id="status">idle</p>');
    expect(watched($('item'), () => $('status').classList.add('error'))).toBe(true);
  });

  it('its own label, what it points to from inside: new text or a new node', () => {
    $('item').insertAdjacentHTML('beforeend', '<span id="own">Play</span>');
    $('item').setAttribute('aria-labelledby', 'own');
    expect(watched($('item'), () => ($('own').textContent = 'Pause'))).toBe(true);
    expect(
      watched($('item'), () => {
        $('own').remove();
        $('item').insertAdjacentHTML('beforeend', '<span id="own">Stop</span>');
      }),
    ).toBe(true);
  });

  it('the heading of what holds the element, replaced', () => {
    const group = $('item').parentElement!;
    group.insertAdjacentHTML('afterbegin', '<h2 id="heading">One</h2>');
    group.setAttribute('aria-labelledby', 'heading');
    expect(
      watched($('item'), () => {
        $('heading').remove();
        group.insertAdjacentHTML('afterbegin', '<h2 id="heading">Two</h2>');
      }),
    ).toBe(true);
  });

  it('a layer with a tooltip and a control, even without text', () => {
    expect(watched($('item'), () => added('<div role="tooltip">Hint</div><button aria-label="Close"></button>'))).toBe(true);
  });

  it('a layer with an empty tooltip and an image', () => {
    expect(watched($('item'), () => added('<div role="tooltip"></div><img alt="" src="data:,">'))).toBe(true);
  });

  it('text added on its own', () => {
    expect(watched($('item'), () => document.body.append(document.createTextNode('Saved')))).toBe(true);
  });

  it('a panel opened by an attribute that is not a look', () => {
    $('status').setAttribute('hidden', '');
    expect(watched($('item'), () => $('status').removeAttribute('hidden'))).toBe(true);
  });

  it('the look of something else', () => {
    expect(watched($('item'), () => $('status').classList.add('lit'))).toBe(true);
  });

  it('a tooltip along with a change in the page', () => {
    expect(
      watched($('item'), () => {
        document.body.insertAdjacentHTML('beforeend', '<div role="tooltip">Hint</div>');
        $('status').textContent = 'open';
      }),
    ).toBe(true);
  });

  it('a change in the page, told before the observer was', () => {
    expect(watched($('item'), () => ($('status').textContent = 'open'))).toBe(true);
  });

  it('another address', () => {
    expect(watched($('item'), () => history.pushState({}, '', '/rail/spaces/1'))).toBe(true);
  });

  it('the focus moved elsewhere inside the same shadow root', () => {
    const root = $('status').attachShadow({ mode: 'open' });
    root.innerHTML = '<button id="one">One</button><button id="two">Two</button>';
    const [one, two] = [root.getElementById('one')!, root.getElementById('two')!];
    one.focus();
    expect(watched(one, () => two.focus())).toBe(true);
  });

  it('the focus moved elsewhere than the element clicked', () => {
    expect(watched($('item'), () => $('field').focus())).toBe(true);
  });

  it("a checkbox's state, through its label too", () => {
    expect(watched($('box'), () => (($('box') as HTMLInputElement).checked = true))).toBe(true);
    expect(watched($('label'), () => (($('box') as HTMLInputElement).checked = false))).toBe(true);
  });

  it('the element clicked gone', () => {
    expect(watched($('item'), () => $('item').remove())).toBe(true);
  });

  it('the element clicked gone, what it pointed to with it', () => {
    $('item').setAttribute('aria-describedby', 'status');
    const token = startChange($('item'))!;
    $('item').parentElement!.remove();
    $('status').textContent = 'gone';
    expect(endChange(token)).toBe(true);
  });

  it('a change inside an open shadow root', () => {
    const root = $('status').attachShadow({ mode: 'open' });
    root.innerHTML = '<span>idle</span>';
    expect(watched($('item'), () => (root.querySelector('span')!.textContent = 'open'))).toBe(true);
  });

  it('a menu in a shadow root attached since the watch began', () => {
    expect(
      watched($('item'), () => {
        const root = $('status').attachShadow({ mode: 'open' });
        root.innerHTML = '<div role="menu"><div role="menuitem">Open</div></div>';
      }),
    ).toBe(true);
  });

  it('a same-origin frame whose document loaded since the watch began', () => {
    document.body.append(document.createElement('iframe'));
    const token = startChange($('item'))!;
    lateFrameDocument = document.implementation.createHTMLDocument();
    lateFrameDocument.body.innerHTML = '<p>Loaded</p>';
    expect(endChange(token)).toBe(true);
  });
});

describe('not watched', () => {
  it('a click whose effect the page does not show (a native picker)', () => {
    expect(startChange($('pick'))).toBeNull();
  });

  it('a watch it no longer has says nothing', () => {
    expect(endChange('gone')).toBe(true);
  });
});
