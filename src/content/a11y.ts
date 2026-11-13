// Compact accessibility-tree-like snapshot, with stable refs to act on.
// Format: Markdown-like, a group on one line when it fits, its parts joined with " · ":
//   --- main ---
//   ## Pricing
//   navigation "Plans": [See plans](/pricing) [ref_3] · [Compare](/compare) [ref_4]
//   textbox "Search" [ref_7] value=""
//   - ### [Basic](/plans/basic) [ref_8] · 9 € a month · button "Choose" [ref_9]
import { collapseSpaces, fold } from '../core/util';
import { HIDDEN } from '../recording/recording';
import { beginAriaCaches, endAriaCaches } from '../vendor/playwright/roleUtils';
import { clipName, INTERACTIVE, isDisabled, isHidden, NAME_FROM_CONTENT, nameOf, quote, roleOf, SKIP_TAGS, textOf } from './a11y-names';
import { childrenOf, isSvg, svgForeignObjects } from './dom-tree';

// A store per document. Its refs carry a short token of their own (ref_k3x_12): a ref read before a
// navigation does not name an element of the next page, it is refused as gone.
export class RefStore {
  private byRef = new Map<string, WeakRef<Element>>();
  private byEl = new WeakMap<Element, string>();
  private next = 1;
  private readonly token = Math.floor(36 ** 2 + Math.random() * (36 ** 3 - 36 ** 2)).toString(36); // 3 characters

  refFor(el: Element): string {
    let ref = this.byEl.get(el);
    if (!ref) {
      ref = `ref_${this.token}_${this.next++}`;
      this.byEl.set(el, ref);
      this.byRef.set(ref, new WeakRef(el));
    }
    return ref;
  }

  get(ref: string): Element | undefined {
    const el = this.byRef.get(ref)?.deref();
    if (!el?.isConnected) {
      this.byRef.delete(ref);
      return undefined;
    }
    return el;
  }
}

interface SnapshotOptions {
  root?: Element;
  filter?: 'interactive' | 'all';
  maxDepth?: number;
  maxNodes?: number;
  viewportOnly?: boolean;
}

interface SnapshotEntry {
  depth: number;
  line: string;
}

interface Snapshot {
  text: string;
  entries: SnapshotEntry[];
  truncated: boolean;
}

// Structural roles, shown only when they contain something.
const STRUCTURAL = new Set(['search', 'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'region', 'list', 'listitem', 'table', 'row', 'article', 'dialog', 'group', 'menu', 'tablist', 'toolbar', 'iframe']);

// Its state, after its name and ref: expanded, disabled, checked, a field's value. A link's href and a
// heading's level are not here: they shape how it is written (describe).
function attrsOf(el: Element, role: string): string {
  const out: string[] = [];
  if (el.getAttribute('aria-expanded')) out.push(`expanded=${el.getAttribute('aria-expanded')}`);
  if (isDisabled(el)) out.push('disabled');
  if (role === 'checkbox' || role === 'radio' || role === 'switch') {
    const checked = el instanceof el.ownerDocument.defaultView!.HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true';
    out.push(checked ? 'checked' : 'unchecked');
  }
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') {
    const isPassword = el.getAttribute('type') === 'password';
    const value = 'value' in el ? String((el as HTMLInputElement).value) : textOf(el);
    out.push(`value=${quote(isPassword && value ? HIDDEN : clipName(value, 60))}`);
  }
  if (role === 'combobox' && el.tagName === 'SELECT') {
    const sel = el as HTMLSelectElement;
    out.push(`value=${quote(clipName(collapseSpaces(sel.selectedOptions[0]?.textContent), 60))}`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

// A link's target, relative to the page's origin when it is on it; none for javascript: links.
function hrefOf(el: Element, origin: string): string | undefined {
  const href = el.getAttribute('href') ?? '';
  if (!href || href.startsWith('javascript:')) return undefined;
  return clipName(href.startsWith(origin) ? href.slice(origin.length) || '/' : href, 80);
}

const headingLevel = (el: Element) => Math.min(6, Math.max(1, Number(el.getAttribute('aria-level') ?? (/^H[1-6]$/.test(el.tagName) ? el.tagName.slice(1) : 2)) || 2));

function inViewport(el: Element): boolean {
  const view = el.ownerDocument.defaultView!;
  const r = el.getBoundingClientRect();
  const margin = 100;
  return r.bottom >= -margin && r.top <= view.innerHeight + margin && r.right >= 0 && r.left <= view.innerWidth;
}

interface TreeNode {
  role: string; // "text" for a run of text
  name: string; // the text, for "text"
  ref?: string;
  href?: string;
  level?: number; // a heading's
  attrs: string;
  structural: boolean;
  children: TreeNode[];
}

// Roots of these roles open a section ("--- main ---"); elsewhere they are groups like any other.
const SECTIONS = new Set(['banner', 'main', 'contentinfo', 'complementary']);
// Wrappers written only by what is in them, unless they have a name.
const SILENT = new Set(['list', 'listitem', 'article', 'row', 'group', 'region', 'table']);
const LISTS = new Set(['list', 'table', 'menu', 'tablist', 'listbox', 'tree']);
const INLINE_MAX = 200; // characters a group may take on one line
const ITEM_TEXT = 80; // characters of text kept in a list item when only interactive elements are read

// One element as the model reads it: a heading as Markdown, a link as [name](href), anything else as
// role "name"; then its ref and its state.
function describe(n: TreeNode): string {
  if (n.role === 'text') return n.name;
  if (n.role === 'heading') return `${'#'.repeat(n.level ?? 2)} ${n.name}`;
  const ref = n.ref ? ` [${n.ref}]` : '';
  if (n.role === 'link' && n.href && n.name) return `[${n.name}](${n.href})${ref}${n.attrs}`;
  return `${n.role}${n.name ? ' ' + quote(n.name) : ''}${ref}${n.attrs}${n.role === 'link' && n.href ? ` href=${n.href}` : ''}`;
}

// The label a group goes under: none for an unnamed wrapper.
const labelOf = (n: TreeNode) => (SILENT.has(n.role) && !n.name ? '' : describe(n));

// A heading with links or buttons inside: the heading written as its only link when that link is all
// it says, else its text and then what is in it.
function headingLine(n: TreeNode): string {
  const only = n.children.length === 1 ? n.children[0]! : undefined;
  if (only && only.name === n.name) return `${'#'.repeat(n.level ?? 2)} ${describe(only)}`;
  return [describe(n), ...n.children.map(inline)].join(' · ');
}

// A node and everything in it on one line, the parts joined with " · ". Kept per node: rendering asks
// again for each group on the way down.
const inlined = new WeakMap<TreeNode, string>();
function inline(n: TreeNode): string {
  let line = inlined.get(n);
  if (line !== undefined) return line;
  if (!n.children.length) line = describe(n);
  else if (n.role === 'heading') line = headingLine(n);
  else {
    const parts = n.children.map(inline).join(' · ');
    const label = labelOf(n);
    line = label ? `${label}: ${parts}` : parts;
  }
  inlined.set(n, line);
  return line;
}

// The lines of the tree: sections as "--- main ---", lists one "- " line per item, and any other group on
// one line when it fits, else its label and its parts below it.
function renderLines(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const pad = (depth: number) => '  '.repeat(depth);
  const node = (n: TreeNode, depth: number, top: boolean) => {
    if (!n.children.length || n.role === 'heading') return void out.push(pad(depth) + inline(n));
    if (top && SECTIONS.has(n.role)) {
      out.push(`--- ${describe(n)} ---`);
      for (const c of n.children) node(c, depth, false);
      return;
    }
    const label = labelOf(n);
    if (LISTS.has(n.role)) {
      // A list of single links or buttons that fits goes on one line, like a group.
      const simple = n.children.every((c) => c.children.length <= 1 && !c.children[0]?.children.length);
      const line = inline(n);
      if (simple && line.length <= INLINE_MAX) return void out.push(pad(depth) + line);
      if (label) out.push(`${pad(depth)}${label}:`);
      for (const c of n.children) item(c, label ? depth + 1 : depth);
      return;
    }
    const line = inline(n);
    if (line.length <= INLINE_MAX) return void out.push(pad(depth) + line);
    if (label) out.push(`${pad(depth)}${label}:`);
    for (const c of n.children) node(c, label ? depth + 1 : depth, false);
  };
  // An item of a list: one "- " line when it fits, else its parts below the bullet.
  const item = (n: TreeNode, depth: number) => {
    const line = inline(n);
    if (line.length <= INLINE_MAX || !n.children.length || n.role === 'heading') return void out.push(`${pad(depth)}- ${line}`);
    const from = out.length;
    const label = labelOf(n);
    if (label) out.push(`${pad(depth + 1)}${label}:`);
    for (const c of n.children) node(c, depth + 1, false);
    if (out.length > from) out[from] = `${pad(depth)}- ${out[from]!.trimStart()}`;
  };
  for (const n of nodes) node(n, 0, true);
  return out;
}

// A field's label is its name: the label's text, next to it, says it again. Left out, in the whole tree.
function dropLabels(nodes: TreeNode[]): TreeNode[] {
  const plain = (s: string) => s.replace(/[\s:*]+$/, '').toLowerCase();
  const names = (n: TreeNode | undefined) => (n && n.role !== 'text' && n.name ? plain(n.name) : undefined);
  return nodes
    .filter((n, i) => n.role !== 'text' || (plain(n.name) !== names(nodes[i + 1]) && plain(n.name) !== names(nodes[i - 1])))
    .map((n) => (n.children.length ? { ...n, children: dropLabels(n.children) } : n));
}

// One snapshot: Playwright's role, name and style caches held for the whole walk (the page does not
// change while it runs).
export function snapshot(doc: Document, refs: RefStore, opts: SnapshotOptions = {}): Snapshot {
  beginAriaCaches();
  try {
    return walkSnapshot(doc, refs, opts);
  } finally {
    endAriaCaches();
  }
}

function walkSnapshot(doc: Document, refs: RefStore, opts: SnapshotOptions): Snapshot {
  const filter = opts.filter ?? 'all';
  const maxDepth = opts.maxDepth ?? 30;
  const maxNodes = opts.maxNodes ?? 500;
  const origin = doc.location?.origin ?? '';
  let count = 0;
  let truncated = false;

  // Text nodes directly inside el (not its descendants') as a "text" node: always with filter=all, and
  // inside a list item or a table row with filter=interactive, short, so that its buttons have
  // something to tell them apart.
  const pushOwnText = (el: Element, out: TreeNode[], max: number) => {
    const own = collapseSpaces([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
    if (own.length > 1) {
      out.push({ role: 'text', name: clipName(own, max), attrs: '', structural: false, children: [] });
      count++;
    }
  };

  // inItem: inside a list item or a table row. inName: inside a heading, whose text is its name:
  // only what can be acted on is kept.
  const walk = (el: Element, depth: number, out: TreeNode[], inItem: boolean, inName: boolean) => {
    if (count >= maxNodes) {
      truncated = true;
      return;
    }
    if (SKIP_TAGS.has(el.tagName) || isHidden(el)) return;
    // An SVG drawing: only the HTML in its foreignObjects, as if it were where the drawing is.
    if (isSvg(el) && el.localName !== 'foreignObject') {
      for (const f of svgForeignObjects(el)) walk(f, depth, out, inItem, inName);
      return;
    }

    const role = roleOf(el);
    const interactive = role !== null && INTERACTIVE.has(role);
    const show =
      role !== null &&
      (inName ? interactive : filter === 'all' || interactive || role === 'heading' || STRUCTURAL.has(role)) &&
      (!opts.viewportOnly || !(interactive || role === 'heading' || role === 'img') || inViewport(el));
    const textMax = filter === 'all' ? 200 : inItem ? ITEM_TEXT : 0;

    if (show && depth <= maxDepth) {
      const name = nameOf(el, role);
      const node: TreeNode = {
        role,
        name,
        ...(interactive && { ref: refs.refFor(el) }),
        ...(role === 'link' && { href: hrefOf(el, origin) }),
        ...(role === 'heading' && { level: headingLevel(el) }),
        attrs: attrsOf(el, role),
        structural: STRUCTURAL.has(role) && !name,
        children: [],
      };
      const childInItem = inItem || role === 'listitem' || role === 'row';
      // A heading is named by its text, but a link or a button in it is still there to act on. The other
      // roles named by their content, and a <select> (its value is shown; its options would be noise,
      // e.g. 200 countries), are not gone into.
      if (role === 'heading') for (const c of childrenOf(el)) walk(c, depth + 1, node.children, childInItem, true);
      else if (!NAME_FROM_CONTENT.has(role) && el.tagName !== 'SELECT') {
        if (textMax && !inName) pushOwnText(el, node.children, textMax);
        for (const c of childrenOf(el)) walk(c, depth + 1, node.children, childInItem, inName);
      }
      if (!node.structural || node.children.length) {
        out.push(node);
        count++;
      }
      return;
    }

    // No role shown: its own text, then flatten into the children.
    if (textMax && !inName && (!opts.viewportOnly || inViewport(el))) pushOwnText(el, out, textMax);
    for (const c of childrenOf(el)) walk(c, depth, out, inItem, inName);
  };

  const walked: TreeNode[] = [];
  const start = opts.root ?? doc.body;
  if (start) walk(start, 0, walked, false, false);
  const roots = dropLabels(walked);

  // One entry per node, for find: the element as the snapshot writes it.
  const entries: SnapshotEntry[] = [];
  const list = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      entries.push({ depth, line: n.role === 'text' ? `text ${quote(n.name)}` : describe(n) });
      list(n.children, depth + 1);
    }
  };
  list(roots, 0);
  return { text: renderLines(roots).join('\n'), entries, truncated }; // the background adds the truncation marker
}

// Text search over the full snapshot: every word must appear, whatever its case and accents. truncated:
// the page has more than the snapshot reads, so a line not found may be past the cut.
export function find(doc: Document, refs: RefStore, query: string, limit = 20): { lines: string[]; truncated: boolean } {
  const words = queryWords(query);
  if (!words.length) return { lines: [], truncated: false };
  const { entries, truncated } = snapshot(doc, refs, { filter: 'all', maxNodes: 5000 });
  const lines = entries
    .map((e) => e.line)
    .filter((line) => matches(line, words))
    .slice(0, limit);
  return { lines, truncated };
}

const queryWords = (query: string) => fold(collapseSpaces(query)).split(' ').filter(Boolean);
const matches = (line: string, words: string[]) => {
  const l = fold(line);
  return words.every((w) => l.includes(w));
};

export interface Tracked {
  found: boolean;
  truncated: boolean;
  retryIn?: number; // a search was due but not run yet: the last one's answer, and when to ask again
}

// A find() asked again and again (wait_for, a watch). A search reads the whole page, so the element the
// first match names (its ref) is kept, and while it is still on the page, shown, and still matches, it
// is all that is read. Otherwise the page is searched again, at most every minMs, and on a page where a
// search is slow, not before as long again as the last one took (the page is never kept searching).
export function tracker(doc: Document, refs: RefStore, query: string, minMs: number): () => Tracked {
  const words = queryWords(query);
  let kept: Element | undefined;
  let last: Tracked = { found: false, truncated: false };
  let next = 0; // when a search may run again
  const stillMatches = (el: Element) => {
    if (!el.isConnected || isHidden(el)) return false;
    const line = snapshot(doc, refs, { root: el, filter: 'all', maxNodes: 1 }).entries[0]?.line;
    return !!line && matches(line, words);
  };
  return () => {
    if (kept && stillMatches(kept)) return { found: true, truncated: false };
    kept = undefined;
    const now = Date.now();
    if (now < next) return { ...last, retryIn: next - now };
    const { lines, truncated } = find(doc, refs, query, 1);
    const end = Date.now();
    next = end + Math.max(minMs - (end - now), end - now);
    const ref = lines[0] && /\[(ref_\w+)\]/.exec(lines[0])?.[1];
    kept = ref ? refs.get(ref) : undefined;
    return (last = { found: lines.length > 0, truncated });
  };
}
