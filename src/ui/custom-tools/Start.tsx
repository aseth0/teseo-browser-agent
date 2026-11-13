// The first step of a custom tool's editor: what it is (three kinds), and for a request, a URL or a
// curl command pasted to fill the next steps, or an example to start from.
import { useState } from 'react';
import { parsePastedRequest } from '../../tools/custom/pasted-request';
import type { CustomInput } from '../../tools/custom/types';
import type { HttpRequest } from '../../tools/http';
import type { Kind } from './useCustomToolDraft';
import type { KindCard } from '../guide';

export const KINDS: KindCard<Kind>[] = [
  { id: 'http', title: 'An HTTP request', about: 'One request to a web API, with its answer cut to what matters.' },
  { id: 'tool', title: 'A tool you have, preset', about: 'One of your tools with some of its parameters set or wrapped (a search on one site).' },
  { id: 'script', title: 'A script', about: "Several requests to a site's API, or a sequence of tools, run as one tool." },
];

// Examples a request starts from, each with the inputs it uses.
const EXAMPLES: { title: string; http: HttpRequest; inputs: CustomInput[] }[] = [
  {
    title: 'Search an API',
    http: { method: 'GET', url: 'https://api.example.com/search?q={query}&limit=10' },
    inputs: [{ name: 'query', type: 'string', description: 'The words to search for', required: true }],
  },
  {
    title: 'Post a message',
    http: { method: 'POST', url: 'https://chat.example.com/api/messages', body: '{\n  "channel": "general",\n  "text": {text}\n}' },
    inputs: [{ name: 'text', type: 'string', description: 'The message to post', required: true }],
  },
  {
    title: 'Read one item by id',
    http: { method: 'GET', url: 'https://api.example.com/items/{id}' },
    inputs: [{ name: 'id', type: 'string', description: "The item's id", required: true }],
  },
];

// A URL or a curl command read into a request (its credentials kept where the model never reads
// them), or an example taken.
export function PasteRequest({ onRequest }: { onRequest: (http: HttpRequest, inputs: CustomInput[], note?: string) => void }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const fill = () => {
    const read = parsePastedRequest(text);
    if ('problem' in read) return setProblem(read.problem);
    setProblem('');
    onRequest(read.http, [], read.notes.join(' ') || undefined);
  };
  return (
    <div className="paste-request">
      <label>Paste a URL or a curl command to fill the next steps
        <textarea aria-label="Paste a URL or a curl command" className="mono" rows={3} value={text}
          placeholder={"https://api.example.com/search?q=cats\ncurl -X POST 'https://api.example.com/items' -H 'Authorization: Bearer …' -d '{…}'"}
          onChange={(e) => setText(e.target.value)} />
      </label>
      {problem && <ul className="problems field-problems"><li>{problem}</li></ul>}
      <div className="row">
        <button type="button" className="primary" onClick={fill} disabled={!text.trim()}>Fill from it</button>
        <span className="muted small">What looks like a key in it stays yours: the model never reads it. Or start from an example:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex.title} type="button" className="insert-chip" onClick={() => onRequest(ex.http, ex.inputs)}>{ex.title}</button>
        ))}
      </div>
    </div>
  );
}
