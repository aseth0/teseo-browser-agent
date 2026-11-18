// The mock server: the shop and other pages, an items API, MCP servers (one behind OAuth) and an
// OpenAI-compatible /v1/chat/completions (mock/llm).
import crypto from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import { EDITOR, ENGINE, PORT, RAIL, SHOP, WEBMCP, WORKER } from '../lib.mjs';
import { respond } from './llm.mjs';
import { apiCalls, leaks, mock, OAUTH } from './state.mjs';

// The voices the mock's text to speech has, and the clip it answers: 0.4 s of a tone and 0.3 s of silence,
// 16-bit mono PCM at 16 kHz.
const SPEECH_VOICES = ['nova_a', 'nova_b'];
const CLIP = (() => {
  const rate = 16000, frames = Math.round(rate * 0.7), data = Buffer.alloc(frames * 2);
  for (let i = 0; i < Math.round(rate * 0.4); i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
})();

export const server = http.createServer((req, res) => {
  const cookie = (name) => new RegExp(`(?:^|; )${name}=([^;]*)`).exec(req.headers.cookie ?? '')?.[1];
  // A LiteLLM-like MCP gateway: it lists its servers, and "notes" speaks MCP (Streamable HTTP, JSON replies).
  if (req.url === '/v1/mcp/server') {
    if (!req.headers.authorization?.startsWith('Bearer ')) return res.writeHead(401).end();
    mcpKey = req.headers.authorization; // the provider's key (the build may set it from the environment)
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ server_name: 'notes', alias: 'notes', description: 'Test notes' }]));
  }
  if (req.url.startsWith('/nowhere/')) return res.writeHead(404).end(); // an MCP server that is not there
  if (req.url === '/notes/mcp') return mcpServer(req, res, () => mcpKey && req.headers['x-litellm-api-key'] === mcpKey); // the same key, in the gateway's header
  // An MCP server behind OAuth (its authorization server on another origin, 127.0.0.1): see oauth().
  if (req.url === '/secure/mcp') {
    // Like Notion's: a browser's Origin is refused (the extension's requests go without one).
    if (req.headers.origin) return json(res, { jsonrpc: '2.0', error: { code: -32000, message: `Invalid Origin: ${req.headers.origin}` }, id: null }, 403);
    if (req.headers.authorization !== `Bearer ${OAUTH.token}`) {
      return res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="http://localhost:${PORT}/.well-known/oauth-protected-resource/secure/mcp"` }).end();
    }
    return mcpServer(req, res, () => true);
  }
  if (req.url.startsWith('/.well-known/oauth-protected-resource')) return json(res, { resource: `http://localhost:${PORT}/secure/mcp`, authorization_servers: [`http://127.0.0.1:${PORT}`] });
  if (req.url.startsWith('/.well-known/oauth-authorization-server') || req.url.startsWith('/oauth/')) return oauth(req, res);
  if (req.url === '/big.html') { // more than a small page budget holds
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<title>Big</title>${Array.from({ length: 200 }, (_, i) => `<button>Product number ${i + 1}</button>`).join('')}`);
  }
  // A search engine shaped like DuckDuckGo (its results come after the page loads), or its robot check.
  if (req.url.startsWith('/?q=')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url.includes('blocked=1')) return res.end('<title>DuckDuckGo</title><div data-testid="anomaly-modal">Select all squares containing a duck</div>');
    const result = (title, href, snippet) => `<article data-testid="result"><h2><a data-testid="result-title-a" href="${href}">${title}</a></h2><div data-result="snippet">${snippet}</div></article>`;
    const asked = new URL(req.url, 'http://localhost').searchParams.get('q');
    const results = result('Platypus - Wikipedia', '/article', `The platypus lays eggs. Searched: ${asked}`) + result('Second result', '/other', 'Left out.');
    return res.end(`<title>platypus at DuckDuckGo</title><main id="r"></main><script>setTimeout(() => { document.getElementById('r').innerHTML = ${JSON.stringify(results)}; }, 600);</script>`);
  }
  // Skills shared as a file (Settings → Skills → Import ▾ → From URL…), read without cookies.
  if (req.url === '/collections/skills.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ skills: [{ name: 'from-url', description: 'Imported from a URL.', body: '1. Do it.' }] }));
  }
  // A source of custom tools, as a file in a team's repository: it wants the session and a token.
  if (req.url === '/tools/team.json') {
    if (!/(^|; )session=abc/.test(req.headers.cookie ?? '') || req.headers['x-token'] !== 't-1') return res.writeHead(401).end('{"error":"not signed in"}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ customTools: mock.teamTools }));
  }
  // A JSON API for custom tools made of an HTTP request: it wants its key; POST says what it created.
  if (req.url.startsWith('/api/items')) {
    if (req.headers['x-key'] !== 'KEY-VALUE-42') return res.writeHead(401).end('{"error":"no key"}');
    apiCalls.push(req.url);
    if (req.method === 'POST') {
      let data = '';
      req.on('data', (c) => (data += c));
      return req.on('end', () => res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ created: JSON.parse(data).name })));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ items: [{ title: 'Platypus fact' }, { title: 'Echidna' }], total: 2 }));
  }
  // An API signed in with the browser's session (a cookie), like Mattermost's /api/v4/users/me.
  if (req.url === '/api/me') {
    if (!/(^|; )session=abc/.test(req.headers.cookie ?? '')) return res.writeHead(401).end('{"error":"not signed in"}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ username: 'perry' }));
  }
  // A search sent as POST with the session, like Mattermost's channels/search: it wants its CSRF header,
  // the value of its MMCSRF cookie.
  if (req.url === '/api/channels/search') {
    if (cookie('session') !== 'abc') return res.writeHead(401).end('{"error":"not signed in"}');
    if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'XMLHttpRequest' || !cookie('MMCSRF') || req.headers['x-csrf-token'] !== cookie('MMCSRF')) return res.writeHead(403).end('{"error":"csrf"}');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ display_name: 'incident-42' }]));
  }
  // A page like Mattermost's: it calls its API on its own, with the headers it wants (the CSRF token
  // from its cookie).
  // A Mattermost-like API across teams, for the script of a custom tool: its teams, the channels you
  // are in (autocomplete) and the public ones (search, a POST with its CSRF header), some in both.
  if (req.url.startsWith('/mm/api/v4/')) {
    if (cookie('session') !== 'abc') return res.writeHead(401).end('{"error":"not signed in"}');
    const send = (value) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    const channel = (id, display_name, last_post_at, delete_at = 0) => ({ id, display_name, name: id, last_post_at, delete_at });
    const path = req.url.split('?')[0];
    if (path === '/mm/api/v4/users/me/teams') return send([{ id: 't1', name: 'ops', display_name: 'Ops' }, { id: 't2', name: 'dev', display_name: 'Dev' }]);
    const team = /^\/mm\/api\/v4\/teams\/(t[12])\/channels\/(search_autocomplete|search)$/.exec(path);
    if (team?.[2] === 'search_autocomplete') return send(team[1] === 't1' ? [channel('c1', 'INC-42 outage', 5)] : []);
    if (team?.[2] === 'search') {
      if (req.method !== 'POST' || req.headers['x-csrf-token'] !== cookie('MMCSRF')) return res.writeHead(403).end('{"error":"csrf"}');
      return send(team[1] === 't1' ? [channel('c1', 'INC-42 outage', 5), channel('c3', 'inc-old', 1, 9)] : [channel('c2', 'INC-42 dev', 9)]);
    }
    return res.writeHead(404).end();
  }
  // What a script must never reach (another origin than its tool's).
  if (req.url.startsWith('/leak')) {
    leaks.push(req.url);
    return res.writeHead(200).end('leaked');
  }
  if (req.url === '/mm.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const poll = "const csrf = /(?:^|; )MMCSRF=([^;]*)/.exec(document.cookie)?.[1] ?? ''; fetch('/api/channels/search', { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}' })";
    return res.end(`<title>Chat</title><h1>Chat</h1><script>setInterval(() => { ${poll}; }, 500);</script>`);
  }
  // A page behind a sign-in: its form (a password field) until the cookie is set; signing in sets it.
  if (req.url === '/private') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if ((req.headers.cookie ?? '').includes('signed=1')) return res.end('<title>Private</title><article><h1>Private</h1><p>PRIVATE FACT: the members area.</p></article>');
    return res.end('<title>Sign in</title><form method="post" action="/sign-in"><input name="user"><input type="password" name="pass"><button>Sign in</button></form>');
  }
  if (req.url === '/sign-in' && req.method === 'POST') {
    res.writeHead(302, { 'Set-Cookie': 'signed=1; Path=/', Location: '/private' });
    return res.end();
  }
  // A page's own API, called while the page is recorded (scenario recording): a search, and a create
  // that answers with a secret-looking value (sent gzip'd too, rec-gzip).
  if (req.url.startsWith('/rec/items')) {
    if (req.method !== 'POST') return json(res, { items: [{ name: 'Echidna' }], query: new URL(req.url, 'http://localhost').searchParams.get('q') });
    const parts = [];
    req.on('data', (c) => parts.push(c));
    return req.on('end', () => {
      const sent = Buffer.concat(parts);
      const body = req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(sent) : sent;
      json(res, { created: JSON.parse(body.toString()).name, id: 4242, sessionToken: 'tok-1' });
    });
  }
  if (req.url === '/article') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<title>Platypus</title><article><h1>Platypus</h1><p>The platypus is a mammal that lays eggs and has a duck bill. PLATYPUS FACT.</p></article>');
  }
  if (req.url === '/deals') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<title>Deals</title><h1>Today\'s deals</h1>');
  }
  if (req.url.startsWith('/worker.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(WORKER);
  }
  if (req.url === '/worker.js') { // the worker of /worker.html: a call of its own
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end("fetch('/api/worker-data').then((r) => r.json()).then((d) => postMessage(d));");
  }
  if (req.url === '/api/worker-data') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ from: 'worker', items: 3 }));
  }
  if (req.url === '/api/customer') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ customer: 'c-4471', name: 'Ann' }));
  }
  if (req.url.startsWith('/rail.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(RAIL);
  }
  if (req.url.startsWith('/engine.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(ENGINE);
  }
  if (req.url.startsWith('/editor.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(EDITOR);
  }
  if (req.url.startsWith('/webmcp.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(WEBMCP);
  }
  // A page that denies the microphone to every frame, its own included (scenarios/voice voice-floating).
  if (req.url === '/no-mic.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Permissions-Policy': 'microphone=()' });
    return res.end('<title>No microphone</title><h1>No microphone here</h1>');
  }
  if (req.url.startsWith('/shop.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(SHOP);
  }
  if (req.url.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'context-usage', context_length: 8192 }] }));
  }
  // Not a LiteLLM gateway nor Ollama: nothing in /model/info nor /api/show about the context window.
  if (req.url.endsWith('/model/info') || req.url.endsWith('/api/show')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }
  // Dictation (voice): each chunk's text is "chunk N", a moment later, as a server takes its time.
  if (req.url === '/v1/audio/transcriptions' && req.method === 'POST') {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    return req.on('end', () => {
      const body = Buffer.concat(parts).toString('latin1');
      const field = (name) => new RegExp(`name="${name}"\r\n\r\n([^\r]*)\r\n`).exec(body)?.[1];
      if (!/name="file"; filename="chunk\.webm"/.test(body)) return json(res, { error: 'no file' }, 400);
      mock.transcriptions.push({ model: field('model'), prompt: field('prompt') ?? '' });
      const text = `chunk ${mock.transcriptions.length}`;
      setTimeout(() => json(res, { text }), 300);
    });
  }
  // Text to speech (Speak): each piece answered, after a while, with a short clip (WAV: a tone, then the
  // closing silence a model leaves); a voice it does not have refused with the list of those it has.
  if (req.url === '/v1/audio/speech' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    return req.on('end', () => {
      const asked = { ...JSON.parse(body), aborted: false, authorization: req.headers.authorization };
      mock.speech.push(asked);
      if (!SPEECH_VOICES.includes(asked.voice)) return json(res, { error: { message: `Voice '${asked.voice}' not found. Available voices: ${SPEECH_VOICES.join(', ')}` } }, 400);
      const done = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(CLIP);
      }, mock.speechDelayMs);
      res.on('close', () => {
        if (!res.writableEnded) {
          clearTimeout(done);
          asked.aborted = true;
        }
      });
    });
  }
  if (req.method !== 'POST') {
    res.writeHead(404);
    return res.end(); // favicon.ico, etc.
  }
  // Embeddings: a text about notes ("add note", or the message "apuntes") points one way, any other another.
  if (req.url.endsWith('/embeddings') && req.method === 'POST') {
    let data = '';
    req.on('data', (c) => (data += c));
    return req.on('end', () => {
      const { input } = JSON.parse(data);
      mock.embedded.push(input);
      json(res, { data: input.map((s, index) => ({ index, embedding: /add note|apuntes/i.test(s) ? [1, 0, 0] : [0, 0, 1] })) });
    });
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // The origin marks the background keeps for the Layers view never reach the model.
    if (/[\uE000-\uE015]/.test(body)) mock.markedRequests++;
    mock.lastAuthorization = req.headers.authorization;
    mock.chatRequests++;
    respond(JSON.parse(body), res);
  });
});

let mcpKey;
const MCP_TOOLS = [
  { name: 'echo', description: 'Echoes the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
  { name: 'add_note', description: 'Adds a note.', inputSchema: { type: 'object', properties: { note: { type: 'string' } } } },
];
function mcpServer(req, res, allowed) {
  if (!allowed()) return res.writeHead(401).end();
  if (req.method !== 'POST') return res.writeHead(req.method === 'DELETE' ? 200 : 405).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const msg = JSON.parse(body);
    if (msg.id === undefined) return res.writeHead(202).end(); // a notification
    const result = {
      initialize: () => ({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1.0.0' } }),
      'tools/list': () => ({ tools: MCP_TOOLS }),
      'tools/call': () => ({ content: [{ type: 'text', text: `${msg.params.name}: ${JSON.stringify(msg.params.arguments)}` }] }),
    }[msg.method]?.();
    // Slow to connect: the panel's tools menu must not wait for it, and gets its tools once in.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'test-session' });
      res.end(JSON.stringify(result ? { jsonrpc: '2.0', id: msg.id, result } : { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } }));
    }, msg.method === 'initialize' ? 2500 : 0);
  });
}

const json = (res, value, status = 200) => res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify(value));
// The authorization server (as 127.0.0.1): metadata, dynamic client registration, a page that asks
// (its Allow sends the code back), and the token endpoint, which checks PKCE.
function oauth(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const base = `http://127.0.0.1:${PORT}`;
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return json(res, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (url.pathname === '/oauth/register') {
      OAUTH.registered++;
      return json(res, { ...JSON.parse(body), client_id: 'browser-agent-test', client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
    }
    if (url.pathname === '/oauth/authorize') {
      const q = url.searchParams;
      if (q.get('allow')) {
        const back = new URL(q.get('redirect_uri'));
        back.searchParams.set('code', 'the-code');
        back.searchParams.set('state', q.get('state'));
        return res.writeHead(302, { Location: back.href }).end();
      }
      OAUTH.challenge = q.get('code_challenge');
      const keep = [...q].map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('');
      return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<title>Sign in</title><form>${keep}<input type="hidden" name="allow" value="1"><button>Allow Browser Agent</button></form>`);
    }
    if (url.pathname === '/oauth/token') {
      const form = new URLSearchParams(body);
      const verified = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === OAUTH.challenge;
      if (form.get('grant_type') !== 'authorization_code' || form.get('code') !== 'the-code' || !verified) return json(res, { error: 'invalid_grant' }, 400);
      OAUTH.exchanged++;
      return json(res, { access_token: OAUTH.token, token_type: 'Bearer', expires_in: 3600, refresh_token: 'secure-refresh' });
    }
    res.writeHead(404).end();
  });
}
