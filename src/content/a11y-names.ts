// An element's role and accessible name, as the snapshot (content/a11y) and find_in_dom
// (content/dom-find) show it.
import { collapseSpaces } from '../core/util';
import { getAriaDisabled, getAriaLabelledByElements, getElementAccessibleName, getElementContentText, isElementHiddenForAria } from '../vendor/playwright/roleUtils';
import { childrenOf, isSvg, svgForeignObjects } from './dom-tree';

// Tags the snapshot does not go into.
export const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'CANVAS']);

export const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider',
  'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'clickable',
]);

// Roles named from their content: their children are not walked.
export const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'treeitem', 'clickable', 'menuitemcheckbox', 'menuitemradio']);

const INPUT_ROLES: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button', file: 'button', color: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', search: 'searchbox', number: 'spinbutton',
};

const TAG_ROLES: Record<string, string> = {
  BUTTON: 'button', SUMMARY: 'button', TEXTAREA: 'textbox', NAV: 'navigation', MAIN: 'main', HEADER: 'banner',
  FOOTER: 'contentinfo', ASIDE: 'complementary', FORM: 'form', DIALOG: 'dialog', TABLE: 'table', TR: 'row',
  UL: 'list', OL: 'list', LI: 'listitem', ARTICLE: 'article', OPTION: 'option', IFRAME: 'iframe',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
};

function ownRole(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit;
  const tag = el.tagName;
  if (tag === 'A') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    return type === 'hidden' ? null : (INPUT_ROLES[type] ?? 'textbox');
  }
  if (tag === 'SELECT') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
  if (tag === 'IMG') return el.getAttribute('alt')?.trim() ? 'img' : null;
  if (tag === 'SECTION') return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
  const byTag = TAG_ROLES[tag];
  if (byTag) return byTag;
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return 'textbox';
  const tabindex = el.getAttribute('tabindex');
  if (el.hasAttribute('onclick') || (tabindex !== null && Number(tabindex) >= 0)) return 'clickable';
  return null;
}

// Something in el the snapshot would show as a control. It stops at the first focusable element, which
// is one or holds one: nested containers never look at the same elements, so a page stays linear.
function holdsInteractive(el: Element): boolean {
  return childrenOf(el).some((c) => {
    if (SKIP_TAGS.has(c.tagName) || isHidden(c)) return false;
    if (isSvg(c) && c.localName !== 'foreignObject') return svgForeignObjects(c).some(holdsInteractive);
    const role = ownRole(c);
    return (role !== null && INTERACTIVE.has(role)) || holdsInteractive(c);
  });
}

// A focusable element with controls inside (a list that scrolls by keyboard) is no control itself: it
// has no role, so the snapshot shows those controls with their refs instead of one name glued from them.
export function roleOf(el: Element): string | null {
  const role = ownRole(el);
  return role === 'clickable' && !el.hasAttribute('onclick') && holdsInteractive(el) ? null : role;
}

// An accessible name is cut to this many characters.
const NAME_CHARS = 100;

export const clipName = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const quote = (s: string) => JSON.stringify(s);

export function textOf(el: Element): string {
  return collapseSpaces(el.textContent);
}

// The accessible name as a browser computes it (Playwright's accname implementation: labels, aria-*,
// alt, title, content without its hidden parts, spaces between blocks). Named by its content only in a
// role of NAME_FROM_CONTENT: a row or a cell named by its text would say it twice, over its parts. A
// group named by aria-labelledby with an element inside it (a <nav> by its own heading) keeps it; an
// item never does (a mail app's rows are labelled by their own subject). A control by the extension's
// own reckoning without a role that names from content (a <div tabindex="0">): its content.
const ITEM_ROLES = new Set(['row', 'cell', 'gridcell', 'columnheader', 'rowheader', 'listitem']);
export function nameOf(el: Element, role: string | null): string {
  const fromContent = !!role && NAME_FROM_CONTENT.has(role);
  const accessible = getElementAccessibleName(el, false);
  const labelled = !!role && !ITEM_ROLES.has(role) && !!getAriaLabelledByElements(el);
  const repeatsContent = accessible.derivedFromContent && !fromContent && !labelled;
  let name = repeatsContent ? '' : accessible.text;
  if (!name && fromContent) name = getElementContentText(el);
  return clipName(collapseSpaces(name), NAME_CHARS);
}

// Its own disabled or aria-disabled, and as Playwright reads it: inside a disabled <fieldset> or <optgroup>, or
// under an aria-disabled ancestor.
export const isDisabled = (el: Element) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || getAriaDisabled(el);

// Left out of the accessibility tree: display:none, visibility, content-visibility, aria-hidden (also an
// ancestor's), not slotted into a shadow root.
export const isHidden = (el: Element): boolean => isElementHiddenForAria(el);

// Short human-readable label of an element, e.g. 'button "Buy now"' (for confirmations).
export function describeElement(el: Element): string {
  const role = roleOf(el) ?? el.tagName.toLowerCase();
  const name = nameOf(el, role);
  return name ? `${role} ${quote(name)}` : role;
}
