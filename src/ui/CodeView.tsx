// Code with syntax colors (JSON, XML…) outside Markdown, and text the model would get with the
// Layers colors of where each part comes from, each part colored as JSON or XML.
import type { ReactNode } from 'react';
import { originRuns } from '../core/model-texts';
import { CutMark } from './LimitMark';
import { lowlight, type HastNode } from '../markdown/tree';
import { originClass } from './origins';

const toReact = (node: HastNode, key: number): ReactNode =>
  node.type === 'text' ? node.value : (
    <span key={key} className={(node.properties?.className as string[] | undefined)?.join(' ')}>{node.children?.map(toReact)}</span>
  );

export function Code({ source, lang }: { source: string; lang?: string }) {
  if (!lang || !lowlight.registered(lang)) return <>{source}</>;
  return <span className="hljs">{(lowlight.highlight(lang, source).children as HastNode[]).map(toReact)}</span>;
}

// JSON indented as it comes, whole or not: an answer cut at a size limit is no longer valid JSON,
// and is still read better indented.
export function indentJson(s: string): string {
  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  const line = () => `\n${'  '.repeat(depth)}`;
  for (const c of s) {
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '{' || c === '[') {
      depth++;
      out += c + line();
    } else if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
      out += line() + c;
    } else if (c === ',') out += c + line();
    else if (c === ':') out += ': ';
    else if (!/\s/.test(c)) out += c;
  }
  return out.replace(/([{[])\n\s*([}\]])/g, '$1$2'); // {} and [] on one line
}

// JSON (formatted when asked; also when cut short), XML or HTML, or plain text.
function looks(s: string, format: boolean): { source: string; lang?: string } {
  const t = s.trim();
  if (/^[[{]/.test(t)) {
    try {
      const parsed = JSON.parse(t) as unknown;
      return { source: format ? JSON.stringify(parsed, null, 2) : s, lang: 'json' };
    } catch {
      // Cut at a limit (or not JSON after all): indented as it is.
      return { source: format ? indentJson(t) : s, lang: 'json' };
    }
  }
  return /^</.test(t) ? { source: s, lang: 'xml' } : { source: s };
}

// Marked text: the fixed parts (tags around values) as XML, each value in its origin's color.
export function MarkedCode({ text, format = false }: { text: string; format?: boolean }) {
  return (
    <>
      {originRuns(text).map(({ text: run, origin, cut }, i) => {
        if (cut) return <CutMark key={i} detail={cut} />;
        if (!origin) return <Code key={i} source={run} lang="xml" />;
        const { source, lang } = looks(run, format);
        return <mark key={i} className={originClass(origin)}><Code source={source} lang={lang} /></mark>;
      })}
    </>
  );
}
