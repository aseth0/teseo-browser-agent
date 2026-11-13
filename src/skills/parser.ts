// Parses SKILL.md: YAML-like frontmatter (name, description, matches) + Markdown body.
// Only the subset Agent Skills use is supported: scalars, ["a", "b"] lists and "- item" lists.
interface ParsedSkill {
  name: string;
  description: string;
  matches: string[];
  body: string;
}

const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, '$2');

// A ["a", 'b', c] list: its items, quoted either way or not (an apostrophe inside "…" stays one; ''
// inside '…' is one, as YAML has it).
function flowList(v: string): string[] {
  const items = v.replace(/^\[|\]$/g, '').match(/\s*"(?:[^"\\]|\\.)*"|\s*'(?:[^']|'')*'|[^,]+/g) ?? [];
  return items.map((raw) => {
    const t = raw.trim();
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (!t.startsWith('"')) return t;
    try {
      return String(JSON.parse(t));
    } catch {
      return t.replace(/^"|"$/g, ''); // not closed, or a bad escape
    }
  }).filter(Boolean);
}

type Frontmatter = Record<string, string | string[]>;

// The frontmatter fields and the Markdown after them. Shared with page templates (TEMPLATE.md).
export function parseFrontmatter(md: string, file: string): { fields: Frontmatter; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file} must start with a --- frontmatter block`);
  const fields: Frontmatter = {};
  let listKey: string | null = null;
  for (const line of m[1]!.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      (fields[listKey] as string[]).push(unquote(item[1]!));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv as unknown as [string, string, string];
    const value = raw.replace(/\s+#.*$/, '').trim(); // trailing comments
    if (value === '') {
      fields[key] = [];
      listKey = key;
    } else if (value.startsWith('[')) {
      fields[key] = flowList(value);
      listKey = null;
    } else {
      fields[key] = unquote(value);
      listKey = null;
    }
  }
  return { fields, body: m[2]!.trim() };
}

// A field that may be written as one value or as a list.
export const listField = (v: string | string[] | undefined) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

export function parseSkillMarkdown(md: string): ParsedSkill {
  const { fields, body } = parseFrontmatter(md, 'SKILL.md');
  const name = typeof fields.name === 'string' ? fields.name : '';
  const description = typeof fields.description === 'string' ? fields.description : '';
  if (!name || !description) throw new Error('SKILL.md needs a name and a description');
  return { name, description, matches: listField(fields.matches), body };
}
