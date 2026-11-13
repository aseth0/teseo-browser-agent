// Plain DOM for the page widget: elements with text set as text, and the model's Markdown.
import { foldSections } from '../../markdown/sections';
import type { HastNode } from '../../markdown/tree';
import { WIDGET_TAG } from '../../page/protocol';

// The model's Markdown, as the background parsed it (markdown/tree): only these elements, a link
// only to a web page or a mail address, and no attribute but the classes of code colors. Never HTML.
const MARKDOWN_TAGS = new Set(['p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'input', 'sup', 'sub']);
// A link the card may open: the web or an e-mail (never javascript: or a data URL).
export const safeHref = (href: unknown): href is string => typeof href === 'string' && /^(https?:|mailto:)/i.test(href);

export function fromTree(node: HastNode): Node[] {
  if (node.type === 'text') return [document.createTextNode(node.value ?? '')];
  const kids = (node.children ?? []).flatMap(fromTree);
  const tag = node.tagName;
  if (node.type !== 'element' || !tag || !MARKDOWN_TAGS.has(tag)) return kids;
  const props = node.properties ?? {};
  if (tag === 'a') {
    const href = props.href;
    return safeHref(href) ? [el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, ...kids)] : kids;
  }
  if (tag === 'input') return props.type === 'checkbox' ? [el('input', { type: 'checkbox', checked: !!props.checked, disabled: true })] : [];
  const element = document.createElement(tag);
  if (Array.isArray(props.className)) element.className = props.className.filter((c) => typeof c === 'string').join(' ');
  if (tag === 'ol' && typeof props.start === 'number') element.setAttribute('start', String(props.start));
  element.append(...kids);
  return [element];
}
export const markdown = (tree: HastNode, folded?: Set<number>) => el('div', { className: 'markdown' }, ...foldableTree(tree, folded));

// The tree with its headings that fold (markdown/sections). `folded`, the places of those folded, is
// kept by whoever builds it again: the card is rebuilt as the answer streams.
export function foldableTree(tree: HastNode, folded = new Set<number>()): Node[] {
  const sections = (node: HastNode): Node[] => {
    if (node.tagName !== 'section') return fromTree(node);
    const [heading, body] = node.children!;
    return [foldSection(heading!, (body!.children ?? []).flatMap(sections), node.properties!.dataFold as number, folded)];
  };
  return (foldSections(tree).children ?? []).flatMap(sections);
}

// Rebuilds what shows the answer: the button of a heading keeps the focus, for the keyboard.
export function keepFoldFocus(within: ParentNode, rebuild: () => void) {
  const focused = within.querySelector<HTMLElement>('.fold-toggle:focus')?.dataset.fold;
  rebuild();
  if (focused) within.querySelector<HTMLElement>(`.fold-toggle[data-fold="${focused}"]`)?.focus();
}

// A section of the card: its heading, with a button that folds what is under it.
function foldSection(heading: HastNode, body: Node[], fold: number, folded: Set<number>): HTMLElement {
  const shown = fromTree(heading)[0] as HTMLElement;
  const title = shown.textContent;
  const section = el('section', { className: 'fold-section' }, shown, el('div', { className: 'fold-body' }, ...body));
  const show = () => {
    const isFolded = folded.has(fold);
    section.classList.toggle('folded', isFolded);
    toggle.setAttribute('aria-expanded', String(!isFolded));
    toggle.ariaLabel = `${isFolded ? 'Unfold' : 'Fold'} ${title}`;
  };
  const toggle = trustedButton({ type: 'button', className: 'fold-toggle' }, () => {
    if (!folded.delete(fold)) folded.add(fold);
    show();
  });
  toggle.dataset.fold = String(fold);
  shown.prepend(toggle);
  show();
  return section;
}

// Outside text is always set as text, never as HTML.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// A button of the widget that answers only the user's own clicks: a page's script cannot press it.
export function trustedButton(props: Partial<HTMLButtonElement>, onClick: () => void): HTMLButtonElement {
  const button = el('button', props);
  button.addEventListener('click', (e) => e.isTrusted && onClick());
  return button;
}

// An action button's icon, and its name shown beside it when the settings say (Settings → Bubble → Actions).
export const actLabel = (icon: string, name: string) => [el('span', { className: 'act-icon', textContent: icon }), el('span', { className: 'act-name', textContent: name })];

// The keys typed in the widget stay in it. Out of its shadow root they would reach the page's
// shortcuts with the host as their target, not the field: a page's "e" would fire as typed and eat
// the letter. A page listening in the capture phase still hears them; most shortcuts listen as they
// bubble. (The widget's own Escape listens on the document in the capture phase, before this.)
export function keepKeys(host: HTMLElement) {
  for (const type of ['keydown', 'keypress', 'keyup']) host.addEventListener(type, (e) => e.stopPropagation());
}

// A host of the widget on the page (the bubble, the floating chat): a tag of its own, so that no
// page rule for divs reaches it, its look all in its closed shadow root. Its tag is never defined: a
// page built of web components that hides what is not defined yet (`:not(:defined)`) would hide it.
export const widgetHost = () => {
  const host = document.createElement(WIDGET_TAG);
  pin(host, { visibility: 'visible', opacity: '1' });
  return host;
};
// Its place and size set `!important`: a page's rule, or a blocker's, can neither hide nor move it.
// The style it leaves is kept (pinnedByWidget): a change to it is the widget's own, any other the page's.
const pinned = new WeakMap<HTMLElement, string | null>();
export function pin(host: HTMLElement, props: Record<string, string>) {
  for (const [name, value] of Object.entries(props)) host.style.setProperty(name, value, 'important');
  pinned.set(host, host.getAttribute('style'));
}

// Whether the host's style is as the widget last set it (pin), not as the page rewrote it since.
export const pinnedByWidget = (host: Element) => host instanceof HTMLElement && pinned.has(host) && pinned.get(host) === host.getAttribute('style');
