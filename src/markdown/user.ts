// The user's own text in the chat, as Markdown (ui/chat/MessageView): its line breaks kept, and the
// mentions attached with it (::site/view, /skill, $tool, #conversation, b::bookmark) marked for
// ui/Markdown to show as chips. The model's text is rendered without these.
import { SLUG } from '../core/sources';

// What a message mentions that was attached, by trigger ('::', '/', '$', '#', 'b::'): name → what its
// chip shows (ui/chat/mentions mentionsIn).
export type Mentioned = Record<string, Map<string, string>>;

// A mention, at the start of the text or after a space (so "std::vector" and "a/b" are not).
export const MENTION_TOKEN = new RegExp(`((?:^|(?<=\\s))(?:b::${SLUG}|::${SLUG}(?:\\/${SLUG})?|\\/${SLUG}|\\$[A-Za-z][\\w-]*(?:\\.[\\w-]+)*|#${SLUG}))`);

// A token (as MENTION_TOKEN finds it) that was attached: its trigger, its name, and what follows the
// name in the token (a sentence may end right after a tool: "$browser.find.").
export function mentionOf(token: string, mentioned: Mentioned): { trigger: string; name: string; rest: string } | undefined {
  const trigger = token.startsWith('b::') ? 'b::' : token.startsWith('::') ? '::' : token[0]!;
  const name = token.slice(trigger.length);
  const found = [name, name.replace(/[.-]+$/, '')].find((n) => mentioned[trigger]?.has(n));
  return found === undefined ? undefined : { trigger, name: found, rest: name.slice(found.length) };
}

// A node of the Markdown tree remark plugins work on (only what these use).
interface MdNode {
  type: string;
  value?: string;
  position?: { start: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: MdNode[];
}

// Each text node (never inline code or a code block, which are other nodes) replaced by what `split`
// makes of it.
function splitTexts(node: MdNode, split: (text: MdNode) => MdNode[]) {
  if (!node.children) return;
  node.children = node.children.flatMap((c) => (c.type === 'text' ? split(c) : (splitTexts(c, split), [c])));
}

// A remark plugin: every line break in the text kept (in a chat, a new line means one).
export function remarkBreaks() {
  return (tree: MdNode) =>
    splitTexts(tree, (t) => (t.value ?? '').split('\n').flatMap((line, i): MdNode[] => [...(i ? [{ type: 'break' }] : []), ...(line ? [{ type: 'text', value: line }] : [])]));
}

// Whether a text node may start a mention at `offset` in the text: at its start or after a space, as
// in the text as written, Markdown marks that open there left aside ("**$browser.find**", "[/skill]",
// not "foo**bar**/skill"); never an escaped one ("\$browser.find").
function opensAt(source: string, offset: number | undefined): boolean {
  if (offset === undefined) return true;
  if (source[offset] === '\\') return false;
  let at = offset;
  while (at > 0 && '*_~(['.includes(source[at - 1]!)) at--;
  return at === 0 || /\s/.test(source[at - 1]!);
}

// A remark plugin: each attached mention a <span data-mention="trigger"> with the name its chip shows,
// which ui/chat/MessageView draws as the chip. Before remarkBreaks, whose nodes have no position.
export function remarkMentions(mentioned: Mentioned) {
  const token = new RegExp(MENTION_TOKEN.source, 'g');
  return (tree: MdNode, file: { value: unknown }) => {
    const source = String(file.value);
    splitTexts(tree, (t) => {
      const value = t.value ?? '';
      const offset = t.position?.start.offset;
      const out: MdNode[] = [];
      let at = 0;
      for (const m of value.matchAll(token)) {
        const found = mentionOf(m[0], mentioned);
        if (!found || (!m.index && !opensAt(source, offset))) continue;
        if (m.index > at) out.push({ type: 'text', value: value.slice(at, m.index) });
        const shown = mentioned[found.trigger]!.get(found.name)!;
        out.push({ type: 'mention', data: { hName: 'span', hProperties: { dataMention: found.trigger } }, children: [{ type: 'text', value: shown }] });
        if (found.rest) out.push({ type: 'text', value: found.rest });
        at = m.index + m[0].length;
      }
      if (!at) return [t];
      if (at < value.length) out.push({ type: 'text', value: value.slice(at) });
      return out;
    });
  };
}
