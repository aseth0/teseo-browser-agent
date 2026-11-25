// The "model": an OpenAI-compatible streaming server whose answers follow the model name each
// scenario picks (real server variants and tool scripts).
import { BRIEF_ANSWER, HELLO, HOST, PORT, WORKER_BRIEF } from '../lib.mjs';
import { leaks, mock } from './state.mjs';

const sse = (res, chunks) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const delta = (d, finish) => ({ choices: [{ delta: d, ...(finish && { finish_reason: finish }) }] });
const say = (res, text) => sse(res, [delta({ content: text }), delta({}, 'stop')]);
const callTool = (res, name, args) =>
  sse(res, [delta({ tool_calls: [{ index: 0, id: 'c1', function: { name, arguments: JSON.stringify(args) } }] }), delta({}, 'tool_calls')]);
const contentOf = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));

// The "model" is picked by name: real server variants and tool scripts.
// Scenarios whose model creates things: it loads them first (tools/load), and the load is left out of
// what the scenario checks.
const CREATES = new Set(['recording-tool', 'site-access', 'skill-save', 'skill-edit', 'skill-edit-full', 'template-save', 'template-edit', 'custom-save', 'custom-try', 'custom-edit', 'action-save', 'action-save-prompt']);
const withoutLoads = (messages) => {
  const loads = new Set(messages.flatMap((m) => (m.tool_calls ?? []).filter((c) => c.function.name === 'tools__load').map((c) => c.id)));
  return messages.filter((m) => !(m.tool_calls?.length && m.tool_calls.every((c) => loads.has(c.id))) && !loads.has(m.tool_call_id));
};

// Whether a skill that guides creating things is named to the model: in the system prompt, or by
// tools.load with the group it loaded (tools/load: they come with the tools).
const namesSkill = (messages, skill) => messages.some((m) => (m.role === 'system' || m.role === 'tool') && contentOf(m).includes(skill));

export function respond(body, res) {
  if (CREATES.has(body.model) && (body.tools ?? []).some((t) => t.function.name === 'tools__load')) {
    // Until then, none of the tools that create things is offered.
    const early = body.tools.map((t) => t.function.name).filter((n) => /^(skills|templates|custom_tools|actions|agents)__(save|edit|delete|try)$/.test(n));
    if (early.length) return say(res, `OFFERED BEFORE LOADING: ${early}`);
    return sse(res, [delta({ tool_calls: [{ index: 0, id: 'load', function: { name: 'tools__load', arguments: JSON.stringify({ groups: ['create'] }) } }] }), delta({}, 'tool_calls')]);
  }
  const { model } = body;
  const messages = CREATES.has(model) ? withoutLoads(body.messages) : body.messages;
  const users = messages.filter((m) => m.role === 'user').map(contentOf);
  const lastUser = users.at(-1) ?? '';
  const toolMsg = messages.find((m) => m.role === 'tool');
  switch (model) {
    case 'recording-tool': { // "Make a tool…": the message asks for a tool, with the recording; a script tool saved
      if (!toolMsg) {
        const ok = lastUser.startsWith('Create a script tool that makes the calls of this recording') && lastUser.includes(`source="recording of ${HOST}" calls="1"`)
          && lastUser.includes('- q = "platypus": a parameter; in #1 query (q)');
        if (!ok) return say(res, `RECORDING TOOL SEES: ${lastUser.slice(0, 600)}`);
        return callTool(res, 'custom_tools__save', {
          name: 'shop.items', description: 'Searches the shop items.', base: 'script', inputs: [{ name: 'q', type: 'string', description: 'Search words', required: true }],
          script: { host: `http://${HOST}`, code: "const r = await request('GET', '/rec/items?q=' + encodeURIComponent(input.q)); if (!r.ok) throw new Error('items: ' + r.status); return r.data.items;" },
        });
      }
      return say(res, contentOf(toolMsg).includes('Saved the custom tool "shop.items"') ? 'TOOL FROM RECORDING OK' : `RECORDING TOOL SAVE: ${contentOf(toolMsg).slice(0, 300)}`);
    }
    case 'recording': { // a recording attached: the calls ticked, secrets and the value hidden by the user left out; no variables (only Make a tool… sends them)
      const ok = lastUser.includes(`<untrusted_page_content source="recording of ${HOST}" calls="3">`) && lastUser.includes('#1 GET /rec/items?q=platypus → 200')
        && lastUser.includes('"name": "Echidna"') && lastUser.includes('"password": "••••"') && lastUser.includes('"sessionToken": "••••"') && lastUser.includes('"id": 4242')
        && !lastUser.includes('Variables, as the user marked them')
        && !lastUser.includes('hunter2') && !lastUser.includes('PRIVATE NOTE') && !lastUser.includes('noise') && !lastUser.includes('tok-1');
      return say(res, ok ? 'RECORDING OK' : `RECORDING SEES: ${lastUser.slice(-700)}`);
    }
    case 'rec-hide-secret': { // a DevTools recording with a value hidden under a name: the model sees ••••[name], never the value
      const ok = lastUser.includes('/api/customer') && lastUser.includes('••••[customer]') && !lastUser.includes('c-4471') && lastUser.includes('{{secret:name}}');
      return say(res, ok ? 'SECRET HIDDEN OK' : `REC SEES call=${lastUser.includes('/api/customer')} named=${lastUser.includes('••••[customer]')} value=${lastUser.includes('c-4471')} sentence=${lastUser.includes('{{secret:name}}')}`);
    }
    case 'error500':
      res.writeHead(500);
      return res.end('upstream exploded');
    case 'widget-say': { // a widget action with only a prompt: the widget's system prompt, the input in the prompt, no tools; streamed
      const ok = contentOf(messages[0]).startsWith('You answer a request made from a button on a web page') && lastUser === 'Translate to Spanish: <untrusted_page_content source="input">PLATYPUS FACT.</untrusted_page_content>' && !body.tools && !body.response_format && body.reasoning_effort === 'high';
      if (!ok) return say(res, `WIDGET SEES: ${JSON.stringify(body).slice(0, 300)}`);
      return sse(res, [delta({ content: null, reasoning_content: 'A word to translate.' }), delta({ content: '**Hecho** del ' }), delta({ content: 'ORNITORRINCO.' }), delta({}, 'stop')]);
    }
    case 'widget-json': { // tool + prompt, two boxes: the tool's answer untrusted after the prompt, a JSON answer asked for
      const ok = body.response_format?.type === 'json_object' && body.reasoning_effort === undefined && lastUser.startsWith('Summarize the items') && lastUser.includes('<untrusted_tool_result tool="api.search">') && lastUser.includes('Echidna')
        && lastUser.includes('- "summary": Summary\n- "first": First');
      return say(res, ok ? '{"summary": "JSON OK: two animals", "first": "Echidna"}' : `{"summary": "WIDGET JSON SEES: ${lastUser.slice(0, 200).replace(/["\n\\]/g, ' ')}", "first": "-"}`);
    }
    case 'repetition-loop': { // thinks in a loop: cut and told; the next message carries the note
      if (users.length === 1) return sse(res, [delta({ content: null, reasoning_content: 'Reading txt_srch=Y1^1' }), ...Array.from({ length: 2000 }, () => delta({ reasoning_content: '^*' })), delta({}, 'length')]);
      return say(res, lastUser.startsWith('[Your previous reply was cut off because it kept repeating "^*". Do not repeat it.]') ? 'LOOP TOLD OK' : `LOOP NOT TOLD: ${lastUser.slice(0, 200)}`);
    }
    case 'reasoning-field':
      return sse(res, [delta({ content: null, reasoning_content: 'The user greets me, ' }), delta({ reasoning_content: 'so I greet back.' }), delta({ content: HELLO }), delta({}, 'stop')]);
    case 'page-context': {
      const ok = lastUser.includes('untrusted_page_content') && /button \\?"Buy now\\?" \[ref_\w+\]/.test(lastUser);
      return say(res, ok ? 'CTX OK' : `CTX MISSING: ${lastUser.slice(0, 300)}`);
    }
    case 'selection-chip': // the text selected on the page goes in the page block
      return say(res, lastUser.includes('Text selected by the user') && lastUser.includes('X1 Headphones') ? 'SELECTION OK' : `SELECTION MISSING: ${lastUser.slice(0, 300)}`);
    case 'selection-skip': // left out with a click on its chip: the page block goes without it
      return say(res, lastUser.includes('untrusted_page_content') && !lastUser.includes('Text selected by the user') ? 'NO SELECTION OK' : `SELECTION SENT: ${lastUser.slice(0, 300)}`);
    case 'context-persist': // 2nd turn: the 1st user message must still carry its page context
      if (users.length < 2) return say(res, 'FIRST');
      return say(res, users[0].includes('untrusted_page_content') ? 'PERSIST OK' : `PERSIST MISSING: ${users[0].slice(0, 200)}`);
    case 'context-unchanged': { // 2nd turn: the page, unchanged, goes as a note; the 1st message keeps it whole
      if (users.length < 2) return say(res, 'FIRST');
      const note = `[The page (http://localhost:${PORT}/shop.html) unchanged since your previous message: see it above.]`;
      const ok = users[0].includes('<untrusted_page_content') && users[1].includes(note) && !users[1].includes('<untrusted_page_content');
      return say(res, ok ? 'UNCHANGED OK' : `UNCHANGED MISSING: ${users[1].slice(0, 300)}`);
    }
    case 'tool-find':
      if (!toolMsg) return callTool(res, 'browser__find', { query: 'buy' });
      return say(res, `FOUND ${contentOf(toolMsg)}`);
    case 'tool-text':
      if (!toolMsg) return callTool(res, 'browser__get_page_text', {});
      return say(res, contentOf(toolMsg).includes('30 hours of battery') ? 'TEXT OK' : `TEXT MISSING: ${contentOf(toolMsg).slice(0, 200)}`);
    // Action scripts: find the element, act on its ref, then check what the page shows.
    // The narrow panel (scenarios/chat): a click allowed for the conversation, then content wider than the panel.
    case 'narrow-panel-with-a-rather-long-model-name': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'browser__find', { query: 'buy now' });
      if (results.length === 1) return callTool(res, 'browser__click', { ref: results[0].match(/\[(ref_\w+)\]/)?.[1] });
      const cells = Array.from({ length: 12 }, (_, i) => `Column number ${i + 1}`);
      return say(res, `NARROW OK ${'Unbroken'.repeat(30)}\n\n\`${'inline_code_without_spaces_'.repeat(8)}\`\n\n\`\`\`js\nconst line = '${'a long line of code '.repeat(12)}';\n\`\`\`\n\n| ${cells.join(' | ')} |\n|${cells.map(() => '---').join('|')}|\n| ${cells.join(' | ')} |\n\n![${'an image alt text '.repeat(6)}](https://example.com/${'wide'.repeat(30)}.png)\n\nhttps://example.com/${'path/'.repeat(30)}`);
    }
    case 'act-click':
    case 'act-type':
    case 'act-select': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const plan = {
        'act-click': { query: 'buy now', tool: 'browser__click', args: {}, expect: 'Cart: 1 item' },
        'act-type': { query: 'search products', tool: 'browser__type', args: { text: 'cable', submit: true }, expect: 'Searched: cable' },
        'act-select': { query: 'color', tool: 'browser__select', args: { value: 'Black' }, expect: 'value="Black"' },
      }[model];
      if (results.length === 0) return callTool(res, 'browser__find', { query: plan.query });
      if (results.length === 1) return callTool(res, plan.tool, { ref: results[0].match(/\[(ref_\w+)\]/)?.[1], ...plan.args });
      // A comment written on the card: the reason of a denial, or ahead of the result of an allowed call.
      if (results[1].includes('the user denied this action and commented: "use the white ones"')) return say(res, 'DENY COMMENT OK');
      if (results[1].startsWith('The user allowed this action and commented: "then checkout"\n\n') && results[1].includes(plan.expect)) return say(res, 'ALLOW COMMENT OK');
      if (results[1].includes('denied')) return say(res, 'DENIED OK');
      return say(res, results[1].includes(plan.expect) ? 'ACT OK' : `ACT MISSING: ${results[1].slice(0, 300)}`);
    }
    case 'word-blacklist': { // the term masked everywhere the model looks, its note in the system prompt; the placeholder it writes restored
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const sent = JSON.stringify(body);
      if (sent.includes('Acme')) return say(res, `WBL LEAK: ${sent.slice(sent.indexOf('Acme') - 200, sent.indexOf('Acme') + 50)}`);
      if (!results.length) {
        const ok = lastUser.includes('Search the shop for CLIENT_A') && contentOf(messages[0]).includes('Some terms in this conversation are placeholders chosen by the user');
        return ok ? callTool(res, 'browser__find', { query: 'search products' }) : say(res, `WBL SEES: ${lastUser.slice(0, 300)}`);
      }
      if (results.length === 1) return callTool(res, 'browser__type', { ref: results[0].match(/\[(ref_\w+)\]/)?.[1], text: 'CLIENT_A', submit: true });
      // Split inside the placeholder: the chat still gets the term.
      if (results[1].includes('Searched: CLIENT_A')) return sse(res, [delta({ content: 'WBL OK for CLIE' }), delta({ content: 'NT_A.' }), delta({}, 'stop')]);
      return say(res, `WBL RESULT: ${results[1].slice(0, 300)}`);
    }
    case 'dom-type': { // browser.find misses the search field (a searchbox, not a textbox); find_in_dom finds it, and its ref types
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'browser__find', { query: 'textbox' });
      if (results.length === 1) {
        if (results[0].includes('Search products')) return say(res, `FIND SAW IT: ${results[0].slice(0, 300)}`);
        return callTool(res, 'browser__find_in_dom', { selector: 'input[type=search]' });
      }
      const ref = results[1].match(/^- input searchbox "Search products" \[(ref_\w+)\] id=\\?"q\\?" type=\\?"search\\?" value=\\?"headphones\\?"$/m)?.[1];
      if (results.length === 2) return ref ? callTool(res, 'browser__type', { ref, text: 'cable', submit: true }) : say(res, `DOM MISSING: ${results[1].slice(0, 300)}`);
      return say(res, results[2].includes('Searched: cable') ? 'DOM TYPE OK' : `DOM TYPE MISSING: ${results[2].slice(0, 300)}`);
    }
    // The DevTools engine (scenarios/devtools): the browser.* tools with real input on /engine.html.
    case 'engine-click':
    case 'engine-type':
    case 'engine-tab':
    case 'engine-hover': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const ref = (r, name) => r.match(new RegExp(`${name}[^\\n]*\\[(ref_\\w+)\\]`))?.[1];
      const plan = {
        'engine-click': { query: 'buy now', act: (r) => ['browser__click', { ref: ref(r, 'Buy now') }], expect: 'Status: bought (trusted)' },
        'engine-type': { query: 'search products', act: (r) => ['browser__type', { ref: ref(r, 'Search products'), text: 'cable', submit: true }], expect: 'Status: searched cable' },
        'engine-tab': { query: 'first field', act: (r) => ['browser__press_key', { ref: ref(r, 'First field'), key: 'Tab' }], expect: 'Status: second field focused' },
        'engine-hover': { query: 'account', act: (r) => ['browser__hover', { ref: ref(r, 'Account') }], expect: 'Your orders' },
      }[model];
      if (results.length === 0) return callTool(res, 'browser__find', { query: plan.query });
      if (results.length === 1) return callTool(res, ...plan.act(results[0]));
      return say(res, results[1].includes(plan.expect) ? `ENGINE OK ${model}` : `ENGINE MISSING ${model}: ${results[1].slice(0, 400)}`);
    }
    // An editor with its own model (/editor.html): its text replaced and sent, added to, and deleted.
    case 'engine-editor':
    case 'engine-unfocused':
    case 'synthetic-editor': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'browser__find', { query: 'message' });
      const ref = results[0].match(/Message[^\n]*\[(ref_\w+)\]/)?.[1];
      const steps = [
        { args: { text: 'hello world', submit: true }, expect: 'Status: sent hello world' },
        { args: { text: ' more', clear: false, submit: true }, expect: 'Status: sent hello world more' },
        { args: { text: '' }, expect: 'Model: (empty)' },
      ];
      const done = results.length - 2; // of the steps, the last one's page in the last result
      if (done >= 0 && !results.at(-1).includes(steps[done].expect)) return say(res, `EDITOR MISSING ${model} ${steps[done].expect}: ${results.at(-1).slice(0, 400)}`);
      if (done + 1 < steps.length) return callTool(res, 'browser__type', { ref, ...steps[done + 1].args });
      return say(res, `EDITOR OK ${model}`);
    }
    // A field that takes nothing (/editor.html?ignoring): typing into it is an error, and Enter is not pressed.
    case 'engine-ignored': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'browser__find', { query: 'message' });
      if (results.length === 1) return callTool(res, 'browser__type', { ref: results[0].match(/Message[^\n]*\[(ref_\w+)\]/)?.[1], text: 'hello', submit: true });
      return say(res, results[1].includes('The text did not reach the field') ? 'IGNORED OK' : `IGNORED MISSING: ${results[1].slice(0, 300)}`);
    }
    // A side rail's entry drawn inside an SVG foreignObject (scenarios/devtools), found by its name without
    // its accent and clicked (real input, or synthetic): its space opens; or, for one whose click only shows
    // its tooltip and its focus, the reply says nothing changed; or, for one whose click only changes a
    // class, it says clicked.
    case 'engine-rail':
    case 'act-rail':
    case 'engine-rail-still':
    case 'act-rail-still':
    case 'engine-rail-look':
    case 'act-rail-look': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const kind = model.split('-')[2] ?? 'open';
      if (results.length === 0) return callTool(res, 'browser__find', { query: { open: 'agora space', still: 'archived space', look: 'muted space' }[kind] });
      const ref = results[0].match(/treeitem "(?:Ágora|Archived|Muted) Space" \[(ref_\w+)\]/)?.[1];
      if (results.length === 1) return ref ? callTool(res, 'browser__click', { ref }) : say(res, `RAIL NOT FOUND ${model}: ${results[0].slice(0, 300)}`);
      const nothing = results[1].startsWith('clicked, but nothing changed');
      const ok = { open: results[1].includes('/rail.html/spaces/10') && !nothing, still: nothing, look: !nothing }[kind];
      return say(res, ok ? `RAIL OK ${model}` : `RAIL MISSING ${model}: ${results[1].slice(0, 400)}`);
    }
    case 'navigate': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__navigate', { url: `http://localhost:${PORT}/deals` });
      return say(res, results[0].includes("Today's deals") ? 'NAV OK' : `NAV MISSING: ${results[0].slice(0, 300)}`);
    }
    case 'act-link': {
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'browser__find', { query: 'deals' });
      if (results.length === 1) return callTool(res, 'browser__click', { ref: results[0].match(/\[(ref_\w+)\]/)?.[1] });
      return say(res, results[1].includes(`Now on: http://${HOST}/deals`) ? 'LINK OK' : `LINK MISSING: ${results[1].slice(0, 300)}`);
    }
    case 'webmcp': { // a tool registered by the page: offered (marked untrusted), confirmed, run in the page
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const tool = (body.tools ?? []).find((t) => t.function.name === 'webmcp__add_to_cart');
      if (!results.length) {
        // The page's tools go last: what goes before them stays the same as the tab moves (prompt cache).
        if (!tool?.function.description.includes('untrusted page content') || !contentOf(messages[0]).includes('webmcp__') || body.tools.at(-1) !== tool) {
          return say(res, `WEBMCP MISSING: ${(body.tools ?? []).map((t) => t.function.name)}`);
        }
        return callTool(res, 'webmcp__add_to_cart', { product: 'cable', quantity: 2 });
      }
      const ok = results[0].includes('<untrusted_page_content source="webmcp" tool="add_to_cart">') && results[0].includes('"cart":2');
      return say(res, ok ? 'WEBMCP OK' : `WEBMCP RESULT: ${results[0].slice(0, 300)}`);
    }
    case 'webmcp-navigate': { // a page with WebMCP reached in this turn: its tool is offered and runs then
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__navigate', { url: `http://localhost:${PORT}/webmcp.html` });
      if (results.length === 1) {
        if (!(body.tools ?? []).some((t) => t.function.name === 'webmcp__add_to_cart')) return say(res, `WEBMCP NAV MISSING: ${(body.tools ?? []).map((t) => t.function.name)}`);
        return callTool(res, 'webmcp__add_to_cart', { product: 'cable', quantity: 2 });
      }
      return say(res, results[1].includes('"cart":2') ? 'WEBMCP NAV OK' : `WEBMCP NAV RESULT: ${results[1].slice(0, 300)}`);
    }
    case 'scroll-reading': { // a long answer that keeps streaming for a while after its first part
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      send(delta({ content: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}: ${'words '.repeat(12)}`).join('\n\n') + '\n\nFIRST-PART-SHOWN\n\n' }));
      let n = 0;
      const timer = setInterval(() => {
        if (++n <= 20) return send(delta({ content: `More ${n}: ${'words '.repeat(12)}\n\n` }));
        clearInterval(timer);
        send(delta({ content: 'END-OF-STREAM' }));
        send(delta({}, 'stop'));
        res.end('data: [DONE]\n\n');
      }, 150);
      return;
    }
    case 'expand-mid-turn': { // a tool with long arguments, then a thought streamed slowly (to unfold the tool meanwhile), then an action to allow
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__find', { query: 'buy now', note: Array.from({ length: 40 }, (_, i) => `line ${i + 1} of a long argument`).join('\n') });
      if (results.length === 2) return say(res, 'EXPAND OK');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      let n = 0;
      const timer = setInterval(() => {
        if (++n <= 30) return send(delta({ content: null, reasoning_content: `Thought ${n}: ${'words '.repeat(10)}\n` }));
        clearInterval(timer);
        send(delta({ tool_calls: [{ index: 0, id: 'c2', function: { name: 'browser__click', arguments: JSON.stringify({ ref: results[0].match(/\[(ref_\w+)\]/)?.[1] }) } }] }));
        send(delta({}, 'tool_calls'));
        res.end('data: [DONE]\n\n');
      }, 100);
      return;
    }
    case 'fold-headings': { // headings to fold while the answer goes on streaming under them
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      send(delta({ content: 'INTRO-TEXT\n\n## Alpha\n\nALPHA-BODY\n\n### Beta\n\nBETA-BODY ' }));
      let n = 0;
      const timer = setInterval(() => {
        if (++n <= 20) return send(delta({ content: `BETA-MORE-${n} ` }));
        clearInterval(timer);
        send(delta({ content: '\n\n## Gamma\n\nGAMMA-BODY FOLD-END' }));
        send(delta({}, 'stop'));
        res.end('data: [DONE]\n\n');
      }, 200);
      return;
    }
    case 'panel-boss': { // the Agents Panel's tools: starts a worker in a row of its own, waits for its answer
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const step = (name, args) => sse(res, [delta({ tool_calls: [{ index: 0, id: `p${results.length}`, function: { name, arguments: JSON.stringify(args) } }] }), delta({}, 'tool_calls')]);
      if (!(body.tools ?? []).some((t) => t.function.name === 'panel__start')) return say(res, 'BOSS HAS NO PANEL TOOLS');
      if ((body.tools ?? []).some((t) => t.function.name === 'agents__ask')) return say(res, 'BOSS HAS AGENTS ASK TOO');
      if (!results.length) return step('panel__start', { agent: 'worker', task: 'count to three', url: `http://localhost:${PORT}/deals`, ...WORKER_BRIEF });
      if (results.length === 1) return results[0].includes('Started worker in row') ? step('panel__wait', { wait_seconds: 60 }) : say(res, `BOSS START: ${results[0].slice(0, 300)}`);
      const ok = results[1].includes('· done') && results[1].includes('<untrusted_agent_answer agent="worker">') && results[1].includes('WORKER DONE');
      return say(res, ok ? 'BOSS OK' : `BOSS WAIT: ${results[1].slice(0, 400)}`);
    }
    case 'panel-boss-async': { // starts the worker and ends its turn; told later that it answered
      if (lastUser.startsWith('The agent "worker" (row ')) {
        const ok = lastUser.includes('has finished:') && lastUser.includes('<untrusted_agent_answer agent="worker">') && lastUser.includes('WORKER DONE');
        return say(res, ok ? 'NOTICED OK' : `NOTICE SEES: ${lastUser.slice(0, 300)}`);
      }
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return sse(res, [delta({ tool_calls: [{ index: 0, id: 'a0', function: { name: 'panel__start', arguments: JSON.stringify({ agent: 'worker', task: 'count to three', url: `http://localhost:${PORT}/deals` }) } }] }), delta({}, 'tool_calls')]);
      return say(res, results[0].includes('Started worker in row') ? 'BOSS STARTED' : `BOSS START: ${results[0].slice(0, 300)}`);
    }
    case 'panel-worker': { // started by panel-boss: its task as the first message, and none of the panel's tools
      if ((body.tools ?? []).some((t) => t.function.name.startsWith('panel__'))) return say(res, 'WORKER HAS PANEL TOOLS');
      // The brief panel-boss sends, laid out in sections; panel-boss-async's task alone. Both end with how to answer
      // (the page block may follow).
      const start = 'The agent "boss" started you in the Agents Panel: count to three';
      const full = `${start}\n\n## Already known\n${WORKER_BRIEF.context}\n\n## Do not\n${WORKER_BRIEF.constraints}\n\n## Done when\n${WORKER_BRIEF.done}\n\n## Send back\n${WORKER_BRIEF.report}`;
      return say(res, lastUser.startsWith(full + BRIEF_ANSWER) || lastUser.startsWith(start + BRIEF_ANSWER) ? 'WORKER DONE' : `WORKER SEES: ${lastUser.slice(0, 400)}`);
    }
    case 'manager-slow': { // the agent manager: an answer that takes a while, for another agent to wait meanwhile
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      let n = 0;
      const timer = setInterval(() => {
        if (++n <= 30) return send(delta({ content: `Slow ${n}. ` }));
        clearInterval(timer);
        send(delta({ content: 'SLOW DONE' }));
        send(delta({}, 'stop'));
        res.end('data: [DONE]\n\n');
      }, 200);
      return;
    }
    case 'long-reply': // longer than the panel: it must scroll to its very end
      return sse(res, [
        delta({ reasoning_content: 'Planning a long answer.' }),
        delta({ content: '**Summary:**\n\n' + Array.from({ length: 30 }, (_, i) => `- **Point ${i + 1}:** ${'words '.repeat(25)}`).join('\n') + '\n\nLAST-LINE-OF-REPLY' }),
        delta({}, 'stop'),
      ]);
    case 'access-deny': { // a tab on a site without access: the user is asked; denied, the error names the tab
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__list_tabs', {});
      if (results.length === 1) {
        const tab = JSON.parse(results[0]).find((t) => t.url?.startsWith(`http://[::1]:${PORT}`));
        return callTool(res, 'browser__read_page', { tabId: tab?.tabId });
      }
      return say(res, results[1].includes(`No permission to read the tab "Deals" ([::1]:${PORT})`) ? 'ACCESS OK' : `ACCESS MISSING: ${results[1].slice(0, 200)}`);
    }
    case 'find-other': { // reads another tab than the panel's: confirmed first (it asks), then read
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__list_tabs', {});
      if (results.length === 1) {
        const tab = JSON.parse(results[0]).find((t) => t.url?.includes('/deals'));
        return callTool(res, 'browser__find', { query: 'deals', tabId: tab?.tabId });
      }
      return say(res, results[1].includes("Today's deals") ? 'OTHER TAB OK' : `OTHER TAB: ${results[1].slice(0, 200)}`);
    }
    case 'skill-values': { // a site skill's page variables arrive resolved, in their own untrusted block
      const want = [
        '<site_skill name="test-values">\nTitle: {{selector:h1}} · Price: {{schema:@Product:offers.price}}',
        '<untrusted_page_content source="site skill test-values">\n{{selector:h1}}: X1 Headphones\n{{schema:@Product:offers.price}}: 129.00\n{{meta:missing}}: (not found on the page)',
        `{{items:nav a; text=; url=?href; icon=img?src}}: 3 items\n1. text: Home\n   url: http://localhost:${PORT}/\n   icon: (not found)\n2. text: Deals`,
      ];
      const missing = want.filter((w) => !users[0].includes(w));
      return say(res, missing.length ? `VALUES MISSING: ${users[0].slice(0, 500)}` : 'VALUES OK');
    }
    case 'skill-save': { // the model saves a skill; the user reviews it whole and allows it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) {
        return callTool(res, 'skills__save', {
          name: 'shop-buy',
          description: 'Buys the product on the demo shop.',
          instructions: '1. Click "Buy now".\n2. Check the cart says {{selector:#cart}}.',
          urlPatterns: ['*://localhost/*'],
        });
      }
      return say(res, results[0].includes('Saved the skill "shop-buy"') ? 'SAVE OK' : `SAVE MISSING: ${results[0].slice(0, 200)}`);
    }
    case 'about-user': { // Settings → About you, in Browser's instructions where {{about_user}} was
      const system = contentOf(messages[0]);
      const missing = [!system.includes('Know the user: I am Alex, ABOUT-ME-42.') && 'the text', system.includes('{{about_user}}') && 'the variable replaced'].filter(Boolean);
      return say(res, missing.length ? `ABOUT MISSING: ${missing.join(', ')}` : 'ABOUT OK');
    }
    case 'skill-edit':
    case 'skill-edit-full': { // the model saves a skill; the user edits its name and description on the card first
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'skills__save', { name: 'shop-note', description: 'Notes the product.', instructions: '1. Read the price.' });
      const want = ['The user edited your proposal before allowing it', 'Description:\n− Notes the product.\n+ Edited by the user.', 'Saved the skill "shop-notes"'];
      const missing = want.filter((w) => !results[0].includes(w));
      return say(res, missing.length ? `EDIT SAVE MISSING: ${results[0].slice(0, 300)}` : 'EDIT SAVE OK');
    }
    case 'memory-prompt': { // pinned whole and an index in the system prompt, the site's items once in the message
      const system = contentOf(messages[0]);
      const tools = (body.tools ?? []).map((t) => t.function.name);
      const missing = [
        !system.includes('## Memory\nRules and facts the user keeps') && 'the memory section',
        !system.includes('- [m-pin] PIN-RULE-7') && 'the pinned item',
        !system.includes('- m-idx: Index rule title') && 'the index line',
        system.includes('Index rule body') && 'only the title in the index',
        system.includes('SITE-RULE-9') && 'the site item outside the system prompt',
        (system + users.join('')).match(/OFF-RULE|NOBODY-RULE/) && 'nothing switched off or for another agent',
        !users[0].includes(`<memory site="${HOST}">\n- [m-site] SITE-RULE-9\n</memory>`) && 'the site block',
        !users[0].includes('- m-title: Site title rule\n</memory_index>') && 'the site index',
        (system + users.join('')).includes('SITE-BODY-3') && 'only the title of what the message does not match',
        !['memory__search', 'memory__read', 'memory__save', 'memory__delete'].every((t) => tools.includes(t)) && 'the memory tools',
        users.length > 1 && users[1].includes('<memory') && 'the site block only once',
      ].filter(Boolean);
      if (users.length < 2) return say(res, missing.length ? `MEMORY MISSING: ${missing.join(', ')}` : 'FIRST');
      return say(res, missing.length ? `MEMORY MISSING: ${missing.join(', ')}` : 'MEMORY OK');
    }
    case 'date-time': { // Settings → About you → Date & time: each message ends with when it was written, sent the same later
      const system = contentOf(messages[0]);
      const line = system.includes('Each user message ends with <message_time>');
      const stamp = /\n<message_time>\w+day, \d{1,2} \w+ \d{4}, \d{2}:\d{2} \([^,()]+, UTC[+-]\d{2}:\d{2}\)<\/message_time>$/;
      if (users.length < 2) {
        mock.firstUser = users[0];
        const missing = [!line && 'the system line', !stamp.test(lastUser) && 'the stamp at the end', lastUser.split('<message_time>').length !== 2 && 'one stamp'].filter(Boolean);
        return say(res, missing.length ? `TIME MISSING: ${missing.join(', ')} / ${lastUser.slice(-160)}` : 'TIME FIRST');
      }
      // Everything switched off between the turns: the first message as it went, the new one without.
      const missing = [users[0] !== mock.firstUser && 'the first message the same', lastUser.includes('<message_time>') && 'no stamp now', line && 'no system line now'].filter(Boolean);
      return say(res, missing.length ? `TIME MISSING: ${missing.join(', ')}` : 'TIME OK');
    }
    case 'memory-stable': { // memory changed between the turns: the same system prompt, the changes with the message
      const system = contentOf(messages[0]);
      if (users.length < 2) {
        mock.firstSystem = system;
        return say(res, 'FIRST');
      }
      const missing = [
        system !== mock.firstSystem && 'the same system prompt',
        !lastUser.includes('<memory_changes>') && 'the changes block',
        !lastUser.includes('- [m-pin] PIN-B') && 'the edited pinned item',
        !lastUser.includes('- m-new: New rule') && 'the new item',
        !lastUser.includes('- m-gone: deleted') && 'the deleted item',
        lastUser.includes('m-idx') && 'nothing unchanged',
      ].filter(Boolean);
      return say(res, missing.length ? `STABLE MISSING: ${missing.join(', ')}` : 'STABLE OK');
    }
    case 'memory-save': { // the model saves an item; the user reviews it whole and allows it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'memory__save', { title: 'Prices', text: 'Prices in euros.\nAlways with VAT.', pinned: true, domains: ['https://www.localhost/'] });
      return say(res, /^Saved to memory as m-\w+: Prices\.$/.test(results[0]) ? 'MEMORY SAVED OK' : `MEMORY SAVE MISSING: ${results[0].slice(0, 200)}`);
    }
    case 'memory-list': { // the model lists the items it is given, a page at a time, without a card
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'memory__list', { limit: 1 });
      const want = 'Memory items, latest first (1-1 of 2):\n- m-b (pinned: yes; sites: every site): Newer rule\n1 more: call memory__list with offset 1 to see them.';
      return say(res, results[0] === want ? 'MEMORY LIST OK' : `MEMORY LIST MISSING: ${results[0].slice(0, 300)}`);
    }
    case 'memory-delete': { // the model deletes an item, confirmed first
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'memory__delete', { id: 'm-del' });
      return say(res, results[0] === 'Deleted m-del from memory.' ? 'MEMORY DELETED OK' : `MEMORY DELETE MISSING: ${results[0].slice(0, 200)}`);
    }
    case 'memory-settings': // written and imported in Settings → Memory: both reach the model
      return say(res, contentOf(messages[0]).includes('] WRITTEN-RULE-3') && contentOf(messages[0]).includes('- [m-imp] IMPORTED-RULE-4') ? 'MEMSET OK' : `MEMSET MISSING: ${contentOf(messages[0]).slice(-300)}`);
    case 'step-limit': { // keeps calling tools past the limit; after Continue it answers
      const rounds = messages.filter((m) => m.role === 'tool').length;
      if (rounds < 16) return callTool(res, 'browser__list_tabs', {});
      return say(res, `CONTINUED OK after ${rounds} rounds`);
    }
    case 'page-template': { // a template's data arrives with its note, and replaces the page's elements
      const want = [
        '<page_template name="test-template" view="main">The page data below was extracted by the view "main" of the template "test-template"',
        `<untrusted_page_content source="template test-template">\nProduct: X1 Headphones\n- Home · http://localhost:${PORT}/\n- Deals`,
        'Not included: the template "test-template" replaces them.',
      ];
      const missing = want.filter((w) => !users[0].includes(w));
      if (users[0].includes('Buy now')) missing.push('the visible elements were sent too');
      if (!contentOf(messages[0]).includes('## Site templates')) missing.push('no system note');
      return say(res, missing.length ? `TEMPLATE MISSING: ${missing.join(' | ')} :: ${users[0].slice(0, 600)}` : 'TEMPLATE OK');
    }
    case 'mention-open': // ::other/main read from another open tab (not the active one)
    case 'mention-background': // ::deals/list read from its fixed URL, opened in a background tab and closed
    case 'mention-failed': { // ::deals/nope: the model is told why it could not be read
      const want = {
        'mention-open': ['<page_template name="other" view="main">The user mentioned ::other/main: the page data below was extracted by that view from the open tab ',
          '<untrusted_page_content source="template other">\nDeals: Today\'s deals'],
        'mention-background': ['The user mentioned ::deals/list: the page data below was extracted by that view from http://localhost/deals, opened in a background tab and closed',
          '<untrusted_page_content source="template deals">\nDeals: Today\'s deals'],
        'mention-failed': ['<page_template mention="::deals/nope">The user mentioned ::deals/nope, but it could not be read: the template "deals" has no view "nope".</page_template>'],
      }[model];
      const missing = want.filter((w) => !users[0].includes(w));
      if (missing.length) return say(res, `MENTION MISSING: ${missing.join(' | ')} :: ${users[0].slice(0, 700)}`);
      // Mentioned again, unchanged: a note, while the first copy goes whole above (context/dedupe).
      if (users.length > 1 && !(lastUser.includes('[The site mention ::other/main unchanged since your previous message: see it above.]') && !lastUser.includes("Today's deals"))) {
        return say(res, `MENTION RESENT: ${lastUser.slice(0, 400)}`);
      }
      return say(res, 'MENTION OK');
    }
    case 'template-save': { // the model tests a draft, then saves it; the user approves
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'templates__run', { views: [{ name: 'main', paths: ['*'], template: 'Product: {{ page | one: "h1" }} · {{ page | one: ".missing" }}' }] });
      if (results.length === 1) {
        const ran = ['View: main (matched *)', 'main:1 one "h1": found 1 of 1 times', 'main:1 one ".missing": nothing found ⚠', 'Product: X1 Headphones'];
        if (!ran.every((w) => results[0].includes(w))) return say(res, `RUN MISSING: ${results[0].slice(0, 300)}`);
        return callTool(res, 'templates__save', { name: 'shop-product', urlPatterns: ['*://localhost/*'], views: [{ name: 'main', paths: ['*'], template: 'Product: {{ page | one: "h1" }}' }] });
      }
      return say(res, results[1].includes('Saved the template "shop-product"') ? 'TSAVE OK' : `TSAVE MISSING: ${results[1].slice(0, 200)}`);
    }
    case 'template-edit': { // the model changes one line of a saved template's view by find/replace; the user approves
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'templates__save', { name: 'shop-facts', views: [{ name: 'main', edits: [{ old: 'Price: {{ page | one: ".price" }}', new: 'Price: {{ page | one: ".price" | strip }}' }] }] });
      return say(res, results[0].includes('Saved the template "shop-facts"') ? 'TEDIT OK' : `TEDIT MISSING: ${results[0].slice(0, 200)}`);
    }
    case 'template-editor': // the template made in the options page reaches the message
      return say(res, users[0].includes('<untrusted_page_content source="template my-template">\nHeading: X1 Headphones') ? 'TEDITOR OK' : `TEDITOR MISSING: ${users[0].slice(0, 400)}`);
    case 'thinking': // the level chosen in the panel's selector reaches the request
      return say(res, body.reasoning_effort === 'high' ? 'THINK OK' : `THINK MISSING: ${body.reasoning_effort}`);
    case 'thinking-rejected': // a model without reasoning: rejects the field, then answers without it
      if ('reasoning_effort' in body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'reasoning_effort is not supported by this model' } }));
      }
      return say(res, HELLO);
    case 'compaction-trim': { // a long reply and a call with long arguments, then trimmed by compaction
      const results = messages.filter((m) => m.role === 'tool');
      if (users.length === 1 && !results.length) return callTool(res, 'browser__find', { query: 'q'.repeat(500) });
      // 2,011 characters that do not repeat themselves (a run of one would be cut as a loop).
      if (users.length === 1) return say(res, `LONG-REPLY ${Array.from({ length: 500 }, (_, i) => `w${i}`).join(' ').slice(0, 2000)}`);
      if (users.length === 2) return say(res, 'A2');
      const reply = messages.find((m) => m.role === 'assistant' && contentOf(m).startsWith('LONG-REPLY'));
      const call = messages.find((m) => m.tool_calls?.length)?.tool_calls[0].function.arguments ?? '';
      const missing = [
        !contentOf(reply ?? {}).includes('the rest of this reply left out to save context: 1,011 characters') && 'the reply cut',
        !call.includes('the arguments of this call left out to save context') && 'the arguments left out',
        !users[0].includes('the site skill test-site left out to save context') && 'the skill left out',
        !lastUser.includes('SITE-RULE-77') && 'the skill again in full',
      ].filter(Boolean);
      return say(res, missing.length ? `TRIMMED SEES: ${missing.join(', ')} | ${users[0].slice(0, 200)}` : 'TRIMMED OK');
    }
    case 'compaction': { // three turns; compacted from the meter (summarized), the fourth goes with the summary
      const system = contentOf(messages[0]);
      if (system.startsWith('Summarize the conversation')) {
        const ok = lastUser.includes('hello 1') && lastUser.includes('hello 2') && !lastUser.includes('hello 3') && lastUser.includes('page content left out to save context');
        // A moment late, for the chat's line while it summarizes.
        return new Promise((done) => setTimeout(() => done(say(res, ok ? 'SUMMARY-OK' : `SUMMARY SEES: ${lastUser.slice(0, 300)}`)), 1500));
      }
      if (!lastUser.includes('hello 4')) return say(res, `A${users.length}`);
      // The site skill's block went with the first turn, now summarized: it goes again in full.
      const ok = users.length === 2 && users[0].includes('<untrusted_conversation_summary turns="2">\nSUMMARY-OK\n</untrusted_conversation_summary>') && users[0].includes('hello 3')
        && system.includes('replaced by an <untrusted_conversation_summary> block')
        && users[0].includes('Still active') && users[1].includes('<site_skill name="test-site">\nSITE-RULE-42') && !users[1].includes('Still active');
      return say(res, ok ? 'COMPACTED OK' : `COMPACTED SEES: ${users.length} | ${users[0].slice(0, 200)} | ${(users[1] ?? '').slice(0, 300)}`);
    }
    case 'compaction-tool': { // the third turn calls chat.compact with instructions; the fourth goes with the summary
      const system = contentOf(messages[0]);
      if (system.startsWith('Summarize the conversation')) {
        const ok = system.includes('Instructions for this summary') && system.includes('keep FOCUS-7') && lastUser.includes('hello 2') && !lastUser.includes('hello 3');
        return say(res, ok ? 'SUMMARY-FOCUS' : `SUMMARY SEES: ${system.slice(-200)} | ${lastUser.slice(0, 200)}`);
      }
      if (lastUser.includes('hello 4')) {
        const ok = users[0].includes('<untrusted_conversation_summary turns="2">\nSUMMARY-FOCUS\n</untrusted_conversation_summary>') && users[0].includes('hello 3');
        return say(res, ok ? 'TOOL COMPACTED OK' : `TOOL COMPACTED SEES: ${users.length} | ${users[0].slice(0, 300)}`);
      }
      if (!lastUser.includes('hello 3')) return say(res, `A${users.length}`);
      if (!toolMsg) return callTool(res, 'chat__compact', { instructions: 'keep FOCUS-7' });
      return say(res, contentOf(toolMsg).includes('will be compacted when this turn ends') ? 'COMPACT CALLED' : `COMPACT RESULT: ${contentOf(toolMsg)}`);
    }
    case 'image-upload': { // your image goes after your text, shrunk to JPEG, as an image_url part
      const last = messages.filter((m) => m.role === 'user').at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [];
      const ok = parts[0]?.type === 'text' && parts[0].text.includes('what is this?') && parts.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg;base64,'));
      return say(res, ok ? 'IMAGE OK' : `IMAGE SEES: ${JSON.stringify(last?.content).slice(0, 200)}`);
    }
    case 'pdf-attach': { // a PDF's pages as text, and a scanned one as a note and the image of its page
      const last = messages.filter((m) => m.role === 'user').at(-1);
      const parts = Array.isArray(last?.content) ? last.content : [];
      const text = parts[0]?.text ?? '';
      const ok = text.includes('<attached_file name="report.pdf">\n[Page 1 of 2]\nHello from example.com, page one.\n\n[Page 2 of 2]\nThe second page of the report.\n</attached_file>')
        && text.includes('<attached_file name="scan.pdf">\nThis PDF has no text layer: pages 1 of 1 are attached as images.\n</attached_file>')
        && parts.filter((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/jpeg;base64,')).length === 1;
      return say(res, ok ? 'PDF OK' : `PDF SEES: ${JSON.stringify(last?.content).slice(0, 400)}`);
    }
    case 'web-read': { // a page whose template is for web__read: read by its template
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'web__read', { url: 'http://localhost/article' });
      const ok = results[0].includes('<page_template name="article-facts"') && results[0].includes('Fact: Platypus') && !results[0].includes('duck bill');
      return say(res, ok ? 'WEB READ OK' : `TEMPLATE READ: ${results[1].slice(0, 300)}`);
    }
    case 'web-sign-in': { // a page asks to sign in: the user signs in its tab, then it is read
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'web__read', { url: 'http://localhost/private' });
      return say(res, results[0].includes('PRIVATE FACT') ? 'SIGN IN OK' : `SIGN IN READ: ${results[0].slice(0, 200)}`);
    }
    case 'context-learned': // refused as too long: the window it names is learned for this model
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: "This model's maximum context length is 16000 tokens. However, you requested 20000 tokens." } }));
    case 'context-retry': // refused as too long once: sent again, shortened more, it is answered
      if (mock.refused++ % 2 === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'prompt is too long', code: 'context_length_exceeded' } }));
      }
      return say(res, 'RETRY OK');
    case 'context-usage': // 2,048 of the 8,192 tokens published by /models → 25 %
      return sse(res, [delta({ content: 'USAGE' }, 'stop'), { choices: [], usage: { prompt_tokens: 2000, completion_tokens: 48 } }]);
    case 'markdown': // leading blank lines, Markdown, and raw HTML that must not render
      return say(res, '\n\n**Bold claim** with `code`\n\n- first item\n- second item\n\n```js\nconst total = 42; // sum\n```\n\n| Name | Price |\n|---|---|\n| Cable | 9 |\n\n<img src=x onerror="document.title=\'pwned\'">');
    case 'history-tools': { // searches the saved conversations, reads the match, answers from it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) {
        if (!contentOf(messages[0]).includes('<untrusted_saved_conversation>')) return say(res, 'HISTORY RULE MISSING');
        return callTool(res, 'history__search', { query: 'brass lamp' });
      }
      if (results.length === 1) return callTool(res, 'history__read', { id: results[0].match(/- ([0-9a-f]{8}) ·/)?.[1] ?? 'none' });
      return say(res, results[1].includes('<untrusted_saved_conversation') && results[1].includes('The brass lamp is 40') ? 'HISTORY OK' : `HISTORY MISSING: ${results.join(' | ').slice(0, 300)}`);
    }
    case 'web-search': { // searches (only the first result kept), reads it, shows it to the user
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'web__search', { query: 'platypus' });
      if (results.length === 1) {
        const ok = results[0].includes('<untrusted_web_results query="platypus" engine="localhost">') && results[0].includes('[Platypus - Wikipedia](http://localhost/article)') && !results[0].includes('Second result');
        return ok ? callTool(res, 'web__read', { url: 'http://localhost/article' }) : say(res, `WEB RESULTS: ${results[0].slice(0, 300)}`);
      }
      if (results.length === 2) {
        const ok = results[1].includes('<untrusted_page_content source="http://localhost/article">') && results[1].includes('PLATYPUS FACT');
        return ok ? callTool(res, 'web__show_user', { url: 'http://localhost/article' }) : say(res, `WEB READ: ${results[1].slice(0, 300)}`);
      }
      // The third round: the request for a plan (plan.start_reminder) goes after this result.
      return say(res, results[2].startsWith('Opened http://localhost/article in a new tab for the user.') ? 'WEB OK' : `WEB SHOWN: ${results[2]}`);
    }
    case 'custom-tool': { // reddit.search: web.search with the query wrapped and one result, fixed
      const offered = (body.tools ?? []).find((t) => t.function.name === 'reddit__search')?.function;
      if (!toolMsg) {
        const params = Object.keys(offered?.parameters?.properties ?? {}).join();
        return offered?.description === 'Searches Reddit threads.' && params === 'query' ? callTool(res, 'reddit__search', { query: 'platypus', limit: 5 }) : say(res, `CUSTOM OFFERED: ${JSON.stringify(offered)}`);
      }
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 1) {
        // Then local.read: its own "page" parameter, the URL built from it.
        const local = (body.tools ?? []).find((t) => t.function.name === 'local__read')?.function;
        const ok = results[0].includes('Searched: platypus site:reddit.com') && !results[0].includes('Second result') && Object.keys(local?.parameters?.properties ?? {}).join() === 'page';
        return ok ? callTool(res, 'local__read', { page: 'article' }) : say(res, `CUSTOM RESULT: ${results[0].slice(0, 200)} ${JSON.stringify(local)}`);
      }
      return say(res, results[1].includes('source="http://localhost/article"') && results[1].includes('PLATYPUS FACT') ? 'CUSTOM OK' : `CUSTOM BUILT: ${results[1].slice(0, 300)}`);
    }
    case 'action-save': { // with create-page-action named (by tools.load), saves a widget action: a wrong path first, the answer back, then right
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const save = (from) => callTool(res, 'actions__save', {
        name: 'Search items', where: ['http://localhost/article'], input: 'selection', tool: 'api.search',
        args: { query: '{input}' }, outputs: [{ label: 'Items', from, link: 'http://localhost/items/{value}' }], sample: 'platypus',
      });
      if (!results.length) return namesSkill(body.messages, 'create-page-action') ? save('items[]') : say(res, 'ACTION SKILL MISSING');
      if (results.length === 1) return results[0].includes('no box found anything') && results[0].includes('<untrusted_tool_answer>') && results[0].includes('Platypus fact') ? save('[]') : say(res, `ACTION TRIAL: ${results[0].slice(0, 300)}`);
      return say(res, results[1].includes('Saved the page widget action "Search items"') ? 'ACTION SAVED OK' : `ACTION SAVE: ${results[1].slice(0, 300)}`);
    }
    case 'action-save-prompt': { // a widget action with only a prompt: not tried, its prompt on the card
      const result = messages.filter((m) => m.role === 'tool').map(contentOf)[0];
      const props = (body.tools ?? []).find((t) => t.function.name === 'actions__save')?.function.parameters.properties ?? {};
      if (!result) return props.prompt && props.agent ? callTool(res, 'actions__save', { name: 'Translate', where: ['http://localhost/article'], input: 'selection', prompt: 'Translate to Spanish: {input}', outputs: [{ label: 'Spanish' }] }) : say(res, 'ACTION SAVE HAS NO PROMPT');
      return say(res, result.includes('Saved the page widget action "Translate"') ? 'PROMPT ACTION SAVED OK' : `ACTION SAVE: ${result.slice(0, 300)}`);
    }
    case 'custom-save': // with the create-custom-tool skill named (by tools.load), saves a custom tool (the user allows it)
      if (!toolMsg) {
        if (!namesSkill(body.messages, 'create-custom-tool')) return say(res, 'CUSTOM SKILL MISSING');
        return callTool(res, 'custom_tools__save', {
          name: 'wiki.read', description: 'Reads a Wikipedia article by its title.', base: 'web.read',
          inputs: [
            { name: 'title', type: 'string', description: 'Article title with underscores', required: true },
            { name: 'lang', type: 'string', description: 'Language code', default: 'es' },
          ],
          params: { url: { template: 'https://{lang}.wikipedia.org/wiki/{title}' } },
        });
      }
      return say(res, contentOf(toolMsg).includes('Saved the custom tool "wiki.read" (runs web.read)') ? 'CUSTOM SAVED OK' : `CUSTOM SAVE: ${contentOf(toolMsg).slice(0, 300)}`);
    case 'custom-try': { // tries me.who with a wrong extract, sees the answer, tries it fixed, then saves it (the user allows each)
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const draft = (extract) => ({ name: 'me.who', description: 'Who the user is signed in as.', base: 'http', http: { method: 'GET', url: 'http://localhost/api/me', session: true, extract } });
      if (!results.length) return callTool(res, 'custom_tools__try', { ...draft('user.name'), sample: {} });
      if (results.length === 1) return results[0].includes("(nothing at user.name; the answer's top-level keys: username)") ? callTool(res, 'custom_tools__try', { ...draft('username'), sample: {} }) : say(res, `TRY WRONG: ${results[0].slice(0, 300)}`);
      if (results.length === 2) return results[1].includes('status="200"') && results[1].includes('perry') ? callTool(res, 'custom_tools__save', draft('username')) : say(res, `TRY FIXED: ${results[1].slice(0, 300)}`);
      return say(res, results[2].includes('Saved the custom tool "me.who"') ? 'CUSTOM TRY OK' : `CUSTOM TRY SAVE: ${results[2].slice(0, 300)}`);
    }
    case 'custom-edit': { // reads api.search (its key not shown), changes its description, then deletes it (the user allows both)
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (results.length === 0) return callTool(res, 'custom_tools__read', { name: 'api.search' });
      if (results.length === 1) {
        const read = results[0];
        const ok = read.includes('# Custom tool: api.search') && read.includes('"X-Key"') && !read.includes('KEY-VALUE-42') && read.includes('items[].title');
        return ok ? callTool(res, 'custom_tools__edit', { name: 'api.search', description: 'Searches the items API by words.' }) : say(res, `CUSTOM READ: ${read.slice(0, 300)}`);
      }
      if (results.length === 2) {
        return results[1].includes('Saved the custom tool "api.search"') ? callTool(res, 'custom_tools__delete', { name: 'api.search' }) : say(res, `CUSTOM EDIT: ${results[1].slice(0, 300)}`);
      }
      return say(res, results[2] === 'Deleted the custom tool "api.search".' ? 'CUSTOM EDIT OK' : `CUSTOM DELETE: ${results[2].slice(0, 300)}`);
    }
    case 'custom-http': { // api.search: a GET with its key in a header, the answer cut to the titles
      if (!toolMsg) {
        const offered = (body.tools ?? []).find((t) => t.function.name === 'api__search')?.function;
        const ok = Object.keys(offered?.parameters?.properties ?? {}).join() === 'query' && !JSON.stringify(body).includes('KEY-VALUE-42');
        return ok ? callTool(res, 'api__search', { query: 'platypus' }) : say(res, `HTTP OFFERED: ${JSON.stringify(offered)}`);
      }
      const got = contentOf(toolMsg);
      const ok = got.includes('<untrusted_http_response status="200" url="http://localhost/api/items?…">') && got.includes('Platypus fact') && !got.includes('total');
      return say(res, ok ? 'HTTP OK' : `HTTP RESULT: ${got.slice(0, 300)}`);
    }
    case 'custom-session': { // the same request with the browser's session and without it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'me__signed', {});
      if (results.length === 1) return callTool(res, 'me__anonymous', {});
      const ok = results[0].includes('status="200"') && results[0].includes('perry') && results[1].includes('status="401"');
      return say(res, ok ? 'SESSION OK' : `SESSION: ${results.join(' | ').slice(0, 300)}`);
    }
    case 'script-tool': { // a script across teams (merged, no repeats, newest first), then one that tries to get out
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'mm__find_all', { term: 'inc-42' });
      if (results.length === 1) {
        const got = results[0];
        const ok = got.includes('requests=\\"5\\"') || got.includes('requests="5"');
        const order = got.indexOf('INC-42 dev') > -1 && got.indexOf('INC-42 dev') < got.indexOf('INC-42 outage') && !got.includes('inc-old') && got.split('INC-42 outage').length === 2;
        return ok && order ? callTool(res, 'leak__try', {}) : say(res, `SCRIPT RESULT: ${got.slice(0, 400)}`);
      }
      if (results.length === 2) return callTool(res, 'leak__navigate', {});
      if (results.length === 3) return callTool(res, 'broken__parse', {});
      if (results.length === 4) return callTool(res, 'broken__declared', { query: 'ab' });
      if (results.length === 5) return callTool(res, 'broken__undefined', {});
      const [, tried, navigated, broken, declared, undefinedName] = results;
      const ok = tried.includes('fetch blocked, request refused, no image, no timers') && navigated.includes('location is not defined') && !leaks.length;
      const located = broken.includes('SyntaxError: ') && broken.includes(' at line 2, column 25:') && broken.includes(`const b = Math.max(a, 2));\n${' '.repeat(24)}^`);
      const hinted = declared.includes('query is already a variable: each input is one, by its name') && undefinedName.includes('navigate is not defined\nA script has input and its inputs by name');
      return say(res, ok && located && hinted ? 'SCRIPT OK' : `SCRIPT LEAK: ${tried.slice(0, 200)} | ${navigated.slice(0, 200)} | ${broken.slice(0, 300)} | ${declared.slice(0, 300)} | ${undefinedName.slice(0, 300)} | ${leaks.join(' ')}`);
    }
    case 'script-steps': { // a script that calls tools switched off for the model: one result, its steps inside
      const offered = (body.tools ?? []).map((t) => t.function.name);
      if (!toolMsg) {
        return offered.includes('steps__check') && !offered.includes('browser__find') && !offered.includes('browser__wait_for')
          ? callTool(res, 'steps__check', {}) : say(res, `STEPS OFFERED: ${offered.join(' ')}`);
      }
      const got = messages.filter((m) => m.role === 'tool').map(contentOf)[0];
      const ok = got.includes('steps="2"') && got.includes('Step 1 · browser.wait_for:') && got.includes('Note: Found 20 buttons') && !got.includes('Step 2')
        && got.includes('Product number 1') && /refused: .*browser\.click.* is not among/.test(got);
      return say(res, ok ? 'STEPS OK' : `STEPS RESULT: ${got.slice(0, 600)}`);
    }
    case 'site-access': { // sees what the site needs (names only), then makes a tool signed in as the user
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'browser__site_access', {});
      if (results.length === 1) {
        const seen = results[0];
        // Header names as the page's fetch sent them (lowercase, in its order): HTTP does not mind.
        const request = /POST \/api\/channels\/search · headers: (.*)/i.exec(seen)?.[1]?.toLowerCase() ?? '';
        const wanted = ['MMCSRF', 'MMAUTHTOKEN (HttpOnly)'].filter((w) => !seen.includes(w)).concat(['x-requested-with', 'x-csrf-token'].filter((h) => !request.includes(h)));
        const leaked = ['csrf-1', 'secret-auth'].filter((v) => seen.includes(v));
        if (wanted.length || leaked.length) return say(res, `SITE ACCESS SEEN: missing ${wanted.join(' + ')}; leaked ${leaked.join(' + ')}; ${seen.slice(seen.indexOf("Requests")).replace(/\s+/g, ' ')}`);
        return callTool(res, 'custom_tools__save', {
          name: 'mm.find', description: 'Finds Mattermost channels.', base: 'http', inputs: [{ name: 'term', type: 'string', description: 'Words', required: true }],
          http: { method: 'POST', url: 'http://localhost/api/channels/search', body: '{"term": {term}}', session: true, headers: [{ name: 'X-Requested-With', value: 'XMLHttpRequest' }, { name: 'X-CSRF-Token', value: '{{cookie:MMCSRF}}' }] },
        });
      }
      return say(res, results[1].includes('Saved') ? 'SITE ACCESS OK' : `SITE ACCESS SAVE: ${results[1].slice(0, 300)}`);
    }
    case 'custom-sources': // a tool synced from a source, with the key the user set in it
      if (!toolMsg) return callTool(res, 'team__search', { query: 'platypus' });
      return say(res, contentOf(toolMsg).includes('Platypus fact') ? 'SOURCES OK' : `SOURCES: ${contentOf(toolMsg).slice(0, 300)}`);
    case 'custom-csrf': { // the same POST with its CSRF header from the cookie, and without it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) return callTool(res, 'mm__search', {});
      if (results.length === 1) return callTool(res, 'mm__no_csrf', {});
      const ok = results[0].includes('status="200"') && results[0].includes('incident-42') && results[1].includes('status="403"');
      return say(res, ok ? 'CSRF OK' : `CSRF: ${results.join(' | ').slice(0, 300)}`);
    }
    case 'custom-http-post': // api.add: a POST, confirmed by the user, its body built from the parameters
      if (!toolMsg) return callTool(res, 'api__add', { name: 'Perry' });
      return say(res, contentOf(toolMsg).includes('status="201"') && contentOf(toolMsg).includes('"created":"Perry"') ? 'HTTP POST OK' : `HTTP POST: ${contentOf(toolMsg).slice(0, 300)}`);
    case 'web-blocked': // the engine shows its robot check: the model is told, with no results made up
      if (!toolMsg) return callTool(res, 'web__search', { query: 'platypus' });
      return say(res, contentOf(toolMsg).includes('showed a CAPTCHA or a consent page') ? 'BLOCKED OK' : `BLOCKED MISSING: ${contentOf(toolMsg).slice(0, 300)}`);
    case 'web-live': { // a real search with the browser's engine: results, or the engine's robot check
      if (!toolMsg) return callTool(res, 'web__search', { query: 'platypus' });
      const got = contentOf(toolMsg);
      if (got.includes('showed a CAPTCHA or a consent page')) return say(res, `WEB LIVE BLOCKED ${got.match(/\(([^)]+)\)/)?.[1] ?? ''}`);
      return say(res, got.includes('<untrusted_web_results') && /- \[[^\]]+\]\(https?:/.test(got) ? `WEB LIVE OK ${got.match(/engine="([^"]+)"/)?.[1]}` : `WEB LIVE: ${got.slice(0, 400)}`);
    }
    case 'history-auto': // the pinned conversation on lamps comes attached on its own
      return say(res, lastUser.includes('was attached automatically (match') && lastUser.includes('The brass lamp is 40') ? 'AUTO OK' : `AUTO MISSING: ${lastUser.slice(0, 300)}`);
    case 'history-mention':
      return say(res, lastUser.includes('The user attached the saved conversation \\"About lamps\\"') || lastUser.includes('The user attached the saved conversation "About lamps"') ? 'MENTION HISTORY OK' : `MENTION HISTORY MISSING: ${lastUser.slice(0, 300)}`);
    case 'mcp': { // the gateway's tools are offered with the untrusted rule; the result comes back wrapped
      const offered = (body.tools ?? []).map((t) => t.function.name);
      if (!toolMsg) {
        const ok = contentOf(messages[0]).includes('<untrusted_mcp_content>') && offered.includes('mcp__notes__echo') && offered.includes('mcp__notes__add_note');
        return ok ? callTool(res, 'mcp__notes__echo', { text: 'hi' }) : say(res, `MCP MISSING: ${offered}`);
      }
      const got = contentOf(toolMsg);
      return say(res, got.includes('<untrusted_mcp_content server=\\"notes\\" tool=\\"echo\\">') || got.includes('<untrusted_mcp_content server="notes" tool="echo">') ? `MCP OK ${got.includes('echo: {') ? 'echo' : ''}` : `MCP RESULT: ${got}`);
    }
    case 'mcp-on-demand': { // the server's tools on demand: offered once loaded, then one is called
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) {
        const load = body.tools?.find((t) => t.function.name === 'tools__load');
        const ok = load?.function.description.includes('- mcp:notes: the 2 tools of the MCP server notes (echo, add_note)') && !offered.some((n) => n.startsWith('mcp__notes__'));
        return ok ? callTool(res, 'tools__load', { groups: ['mcp:notes'] }) : say(res, `MCP OFFERED: ${offered}`);
      }
      // Loaded: offered, and no longer a line of tools.load (which stays for create).
      const still = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description.includes('mcp:notes');
      if (results.length === 1) return offered.includes('mcp__notes__echo') && !still ? callTool(res, 'mcp__notes__echo', { text: 'hi' }) : say(res, `MCP NOT LOADED: ${offered}`);
      return say(res, results[1].includes('<untrusted_mcp_content server="notes" tool="echo">') ? 'MCP ON DEMAND OK' : `MCP RESULT: ${results[1].slice(0, 200)}`);
    }
    case 'tool-match-about': { // Only matching, by the server's own description: its tools offered, the web's held
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
      const ok = offered.includes('mcp__notes__add_note') && !offered.some((n) => n.startsWith('web__')) && load.includes('- web: ') && !body.tools.some((t) => t.function.name.includes('about'));
      return say(res, ok ? 'TOOL ABOUT OK' : `TOOL ABOUT MISSING: ${offered} / ${load.slice(0, 300)}`);
    }
    case 'tool-match-unsure': { // Only matching, a message that points at no tool: nothing held
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
      const ok = offered.includes('mcp__notes__echo') && offered.some((n) => n.startsWith('web__')) && !load.includes('mcp:notes') && !load.includes('- web: ');
      return say(res, ok ? 'TOOL UNSURE OK' : `TOOL UNSURE MISSING: ${offered} / ${load.slice(0, 300)}`);
    }
    case 'tool-match': { // Only matching, a message about the web: its tools offered, the notes server's listed in tools.load
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      if (!results.length) {
        const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
        const ok = load.includes('- mcp:notes: the 2 tools of the MCP server notes (echo, add_note)') && !load.includes('- web: ')
          && !offered.some((n) => n.startsWith('mcp__notes__')) && offered.includes('web__search') && offered.includes('browser__find') && offered.includes('user__ask');
        return ok ? callTool(res, 'tools__load', { groups: ['mcp:notes'] }) : say(res, `TOOL MATCH OFFERED: ${offered} / ${load.slice(0, 400)}`);
      }
      if (results.length === 1) return offered.includes('mcp__notes__echo') ? callTool(res, 'mcp__notes__echo', { text: 'hi' }) : say(res, `TOOL MATCH NOT LOADED: ${offered}`);
      return say(res, results[1].includes('<untrusted_mcp_content server="notes" tool="echo">') ? 'TOOL MATCH OK' : `TOOL MATCH RESULT: ${results[1].slice(0, 200)}`);
    }
    case 'tool-meaning': { // Only matching, by meaning: the notes server offered for a message with none of its words
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
      const ok = offered.includes('mcp__notes__add_note') && !offered.some((n) => n.startsWith('web__')) && load.includes('- web: ');
      return say(res, ok ? 'TOOL MEANING OK' : `TOOL MEANING MISSING: ${offered} / ${load.slice(0, 300)}`);
    }
    case 'tool-match-server': { // All tools, the server Only when it matches: it alone waits in tools.load
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
      const ok = !offered.some((n) => n.startsWith('mcp__notes__')) && offered.some((n) => n.startsWith('web__')) && load.includes('- mcp:notes: ') && !load.includes('- web: ');
      return say(res, ok ? 'TOOL SERVER OK' : `TOOL SERVER MISSING: ${offered} / ${load.slice(0, 300)}`);
    }
    case 'tool-match-always': { // Only matching, the server Always offered: its tools go, the web's wait in tools.load
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const load = body.tools?.find((t) => t.function.name === 'tools__load')?.function.description ?? '';
      const ok = offered.includes('mcp__notes__echo') && !offered.some((n) => n.startsWith('web__')) && load.includes('- web: ') && !load.includes('mcp:notes');
      return say(res, ok ? 'TOOL ALWAYS OK' : `TOOL ALWAYS MISSING: ${offered} / ${load.slice(0, 300)}`);
    }
    case 'tool-recommend': { // Recommended: every tool offered, the server's group named with the message, the tool it matches first
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const ok = lastUser.includes('Tool groups that match this message:') && lastUser.includes('- MCP · notes: mcp__notes__add_note, mcp__notes__echo')
        && offered.includes('mcp__notes__add_note') && offered.some((n) => n.startsWith('web__'));
      return say(res, ok ? 'TOOL RECOMMEND OK' : `TOOL RECOMMEND MISSING: ${offered} / ${lastUser.slice(0, 400)}`);
    }
    case 'user-ask': { // asks two questions, then says what came back
      if (!toolMsg) return callTool(res, 'user__ask', { questions: [
        { question: 'Which size?', header: 'Size', type: 'choice', options: [{ label: 'S' }, { label: 'M', description: 'regular fit' }] },
        { question: 'Anything else?', type: 'text', placeholder: 'e.g. gift wrap' },
      ] });
      const got = contentOf(toolMsg);
      return say(res, got.includes('- Size: M') && got.includes('- Anything else?: gift wrap') ? 'ASK OK' : `ASK MISSING: ${got}`);
    }
    case 'user-plan': {
      if (!toolMsg) return callTool(res, 'user__plan', { steps: [{ title: 'Find the product', status: 'done' }, { title: 'Pick the size', status: 'in_progress' }, { title: 'Add to cart', status: 'pending' }] });
      return say(res, contentOf(toolMsg).includes('1 of 3 steps done') ? 'PLAN OK' : `PLAN MISSING: ${contentOf(toolMsg)}`);
    }
    case 'user-pick': {
      if (!toolMsg) return callTool(res, 'user__pick_element', { prompt: 'Click the buy button' });
      return say(res, /The user picked button "Buy now" \[ref_\w+\]/.test(contentOf(toolMsg)) ? 'PICK OK' : `PICK MISSING: ${contentOf(toolMsg)}`);
    }
    case 'inline-mentions': { // /skill attaches it, $tool asks for it, offers it though off, and forces it
      const offered = (body.tools ?? []).map((t) => t.function.name);
      const ok = lastUser.includes('<skill name="summarize-page">') && lastUser.includes('The user asks you to use browser__find for this message.')
        && offered.includes('browser__find') && body.tool_choice?.function?.name === 'browser__find';
      return say(res, ok ? 'INLINE OK' : `INLINE MISSING: ${JSON.stringify(body.tool_choice)} ${offered} ${lastUser.slice(0, 200)}`);
    }
    case 'limit-cut': { // a page block over its budget (Settings → Limits) says what was cut or left out
      const cut = /…\[truncated\]|left out: over the page budget/.test(lastUser);
      return say(res, cut ? 'CUT OK' : `NOT CUT: ${lastUser.length}`);
    }
    case 'stop': { // streams part of an answer and hangs until stopped; then checks it was told
      const partial = messages.some((m) => m.role === 'assistant' && contentOf(m) === 'PARTIAL ANSWER');
      if (users.length > 1) return say(res, partial && lastUser.startsWith('[The user stopped the previous turn') ? 'RESUMED OK' : `NOT TOLD: ${partial} ${lastUser.slice(0, 120)}`);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const c of [delta({ reasoning_content: 'Half a thought' }), delta({ content: 'PARTIAL ' }), delta({ content: 'ANSWER' })]) res.write(`data: ${JSON.stringify(c)}\n\n`);
      return; // never ends
    }
    case 'message-actions': { // a regenerated message carries the page once, read again (whole, or as the note that it is unchanged)
      const pages = lastUser.split('<untrusted_page_content').length - 1 + lastUser.split('unchanged since your previous message').length - 1;
      return say(res, pages === 1 ? `REPLY ${++mock.replies}` : `CONTEXT x${pages}`);
    }
    case 'skill-catalog': {
      const system = contentOf(messages[0]);
      const offered = (body.tools ?? []).map((t) => t.function.name);
      if (!toolMsg) {
        if (!system.includes('- summarize-page:') || !offered.includes('skills__load')) return say(res, `CATALOG MISSING: ${offered}`);
        return callTool(res, 'skills__load', { name: 'summarize-page' });
      }
      return say(res, contentOf(toolMsg).includes('# Skill: summarize-page') ? 'SKILL OK' : `SKILL MISSING: ${contentOf(toolMsg).slice(0, 200)}`);
    }
    case 'site-skill': { // full instructions on the first turn, a reminder on the second
      if (users.length < 2) return say(res, 'FIRST');
      const ok = users[0].includes('<site_skill name="test-site">\nSITE-RULE-42') && users[1].includes('Still active') && !users[1].includes('SITE-RULE-42');
      return say(res, ok ? 'SITE OK' : `SITE MISSING: ${users.join(' | ').slice(0, 400)}`);
    }
    case 'skill-editor':
      return say(res, contentOf(messages[0]).includes('* my-skill — Created from the options page.') ? 'EDITOR OK' : 'EDITOR MISSING');
    case 'mock-model': // the model listed by /models, chosen from the picker
      return say(res, 'PICKED mock-model');
    case 'agent': { // talked to as the "jira" agent: only its tool (and tools.read_more), its instructions, no page (its site is not this one)
      const tools = (body.tools ?? []).map((t) => t.function.name).join(',');
      const system = contentOf(messages[0]);
      if (!toolMsg) {
        const told = lastUser.includes('No web page is attached to this message: the page is not among the sites of the agent "jira".');
        if (tools !== 'browser__find,tools__read_more' || !system.includes('## Agent: jira\nKeys look like INC-1.') || lastUser.includes('untrusted_page_content') || !told) return say(res, `AGENT SEES: ${tools} | ${system.slice(-120)} | page: ${lastUser.includes('untrusted_page_content')} | told: ${told}`);
        return callTool(res, 'browser__find', { query: 'Buy' });
      }
      return say(res, contentOf(toolMsg).includes('may not use localhost') ? 'AGENT OK' : `AGENT FIND: ${contentOf(toolMsg).slice(0, 200)}`);
    }
    case 'agent-mention': { // @mm: the note names it, agents.ask is offered with mm, and no tool is forced
      const ask = (body.tools ?? []).find((t) => t.function.name === 'agents__ask')?.function;
      const ok = lastUser.includes('The user wants mm to do this: ask them with agents__ask.') && ask?.parameters.properties.agent.enum.join() === 'mm'
        && !body.tool_choice && !lastUser.includes('The user wants someone');
      return say(res, ok ? 'AGENT MENTION OK' : `AGENT MENTION MISSING: ${JSON.stringify(body.tool_choice)} ${JSON.stringify(ask)?.slice(0, 200)} ${lastUser.slice(0, 300)}`);
    }
    case 'sub-jira': { // jira asks mattermost (a sub-agent with its own model and tool), then answers with what it got
      const ask = (body.tools ?? []).find((t) => t.function.name === 'agents__ask')?.function;
      if (!toolMsg) {
        const ok = ask?.parameters.properties.agent.enum.join() === 'mm' && ask.description.includes('- mm: Searches the shop') && contentOf(messages[0]).includes('<untrusted_agent_answer>');
        return ok ? callTool(res, 'agents__ask', { agent: 'mm', task: 'Find the buy button' }) : say(res, `SUB ASK: ${JSON.stringify(ask)?.slice(0, 300)}`);
      }
      const answer = contentOf(toolMsg);
      const ok = answer.includes('<untrusted_agent_answer agent="mm">') && answer.includes('MM FOUND') && answer.endsWith('</untrusted_agent_answer>\n(It made 1 tool call; 0 failed.)');
      return say(res, ok ? 'SUB OK' : `SUB ANSWER: ${answer.slice(0, 300)}`);
    }
    case 'agent-save': { // Builder lists what exists, then saves an agent; the user reviews it and allows it
      const results = messages.filter((m) => m.role === 'tool').map(contentOf);
      const tools = (body.tools ?? []).map((t) => t.function.name).sort().join();
      if (!results.length) return tools === ['actions__delete', 'actions__read', 'agents__catalog', 'agents__delete', 'agents__save', 'browser__click', 'browser__find_in_dom', 'browser__get_html', 'browser__navigate', 'browser__press_key', 'browser__scroll', 'browser__select', 'browser__type', 'custom_tools__delete', 'custom_tools__edit', 'custom_tools__read', 'custom_tools__try', 'skills__delete', 'skills__read', 'templates__delete', 'tools__read_more'].join() ? callTool(res, 'agents__catalog', {}) : say(res, `BUILDER SEES: ${tools}`);
      // The catalog lists groups, not tools; a group's tools come with "group".
      if (results.length === 1) {
        if (results[0].includes('"name": "browser.find"') || !results[0].includes('"toolGroups"')) return say(res, `CATALOG: ${results[0].slice(0, 300)}`);
        return callTool(res, 'agents__catalog', { group: 'browser' });
      }
      if (results.length === 2) {
        if (!results[1].includes('"name": "browser.find"') || results[1].includes('"name": "skills.save"')) return say(res, `CATALOG GROUP: ${results[1].slice(0, 300)}`);
        return callTool(res, 'agents__save', { name: 'Shop', icon: '🛒', description: 'Finds products on the shop', instructions: ['Only read.', ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${n}. Check listing page ${n}.`)].join('\n'), tools: ['browser.find'], sites: { [HOST]: 'auto' }, canBeAsked: true });
      }
      return say(res, results[2].includes('Saved the agent "Shop"') ? 'AGENT SAVED OK' : `AGENT SAVE: ${results[2].slice(0, 200)}`);
    }
    case 'sub-mm': { // the sub-agent: only the task, its own tool (and tools.read_more), no page block
      if (!toolMsg) {
        const first = contentOf(messages[1]);
        const tools = (body.tools ?? []).map((t) => t.function.name).join();
        // The task, then when it was asked (Settings → About you → Date & time).
        const [task, stamp = ''] = first.split('\n<message_time>');
        if (messages.length !== 2 || task !== `The agent "jira" asks you: Find the buy button${BRIEF_ANSWER}` || !/^\w+day, .+<\/message_time>$/.test(stamp) || tools !== 'browser__find,tools__read_more') return say(res, `MM SEES: ${messages.length} ${first} | ${tools}`);
        return callTool(res, 'browser__find', { query: 'Buy' });
      }
      return say(res, contentOf(toolMsg).includes('[ref_') ? 'MM FOUND the button' : `MM FIND: ${contentOf(toolMsg).slice(0, 200)}`);
    }
    case 'tools-offered': // reports the tool names it was offered
      return say(res, `TOOLS ${(body.tools ?? []).map((t) => t.function.name).join(',')}`);
    case 'tool-structured':
      if (!toolMsg) return callTool(res, 'browser__get_structured_data', {});
      return say(res, contentOf(toolMsg).includes('129.00') ? 'LD OK' : `LD MISSING: ${contentOf(toolMsg).slice(0, 200)}`);
    default:
      return sse(res, ['Hello, ', 'I am ', 'the mock.'].map((t) => delta({ content: t })).concat([delta({}, 'stop')]));
  }
}
