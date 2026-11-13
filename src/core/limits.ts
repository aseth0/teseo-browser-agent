// Size limits on what reaches the model: one place for their values, what each one cuts and how.
// Most can be changed in Settings → Limits; the background (and the pages that preview requests)
// apply those with setLimitOverrides() before building anything. The page scripts have no overrides:
// a limit they apply comes with the request (maxNodes, maxChars…).

// Model requests in one run, unless the caller sets maxSteps (core/agent-loop).
export const DEFAULT_MAX_STEPS = 15;

export type LimitId =
  | 'pageBudget'
  | 'pageElements'
  | 'readPageElements'
  | 'selection'
  | 'templateOutput'
  | 'renderDepth'
  | 'skillValue'
  | 'skillItems'
  | 'mentions'
  | 'historyAttach'
  | 'imagesPerMessage'
  | 'imageSize'
  | 'memory'
  | 'toolResult'
  | 'pageText'
  | 'actionPageText'
  | 'structuredData'
  | 'findInDomMatches'
  | 'webmcpTools'
  | 'webmcpDescription'
  | 'webmcpSchema'
  | 'webmcpResult'
  | 'recording'
  | 'attachedFile'
  | 'tabAudio'
  | 'tabAudioMinutes'
  | 'waitFor'
  | 'watches'
  | 'panelAgents'
  | 'panelNotices'
  | 'watchMinutes'
  | 'modelFirstByte'
  | 'modelIdle'
  | 'speakText'
  | 'scriptTime'
  | 'scriptSteps'
  | 'scriptStepsTime'
  | 'screenshotSize'
  | 'pageTextMax'
  | 'summaryText'
  | 'pinnedMemory'
  | 'siteMemoryItems'
  | 'aboutUser'
  | 'planReminder'
  | 'planReminderAlways';

interface LimitDef {
  label: string; // what is limited
  value: number; // the default
  // 'tokens': as estimated (context/budget), not corrected for the model (context/token-ratio), so a
  // limit cuts the same text whatever the model and does not move as a ratio is learned.
  unit: 'tokens' | 'characters' | 'elements' | 'levels' | 'records' | 'mentions' | 'tools' | 'images' | 'pixels' | 'seconds' | 'watches' | 'minutes' | 'steps' | 'items' | 'agents' | 'notices' | 'tool calls';
  over: string; // what happens past it
  range?: [min: number, max: number]; // can be changed in Settings → Limits, within these
}

export const LIMIT_DEFS: Record<LimitId, LimitDef> = {
  pageBudget: {
    label: 'Page block',
    value: 1500,
    unit: 'tokens',
    over: 'filled by priority (page details, then selected text, then visible elements): the first part that does not fit is cut, the rest left out with a note',
    range: [500, 20000],
  },
  pageElements: { label: 'Visible elements read from the page', value: 300, unit: 'elements', over: 'the rest are left out, with a note', range: [50, 2000] },
  readPageElements: { label: 'Elements read by browser__read_page', value: 800, unit: 'elements', over: 'the rest are left out, with a note', range: [100, 5000] },
  selection: { label: 'Selected text', value: 4000, unit: 'characters', over: 'cut, with a note', range: [500, 50000] },
  templateOutput: { label: 'Site template output', value: 4000, unit: 'characters', over: 'cut at whole lines; the note says how many were left out', range: [500, 50000] },
  // Fixed: checked when a template is saved, so a lower one would break templates saved already.
  renderDepth: { label: 'Nested {% render %} in site templates', value: 3, unit: 'levels', over: 'the template fails with an error' },
  skillValue: { label: 'Site skill value', value: 2000, unit: 'characters', over: 'cut, with a note (lists: whole records, then how many more)', range: [200, 20000] },
  skillItems: { label: 'Records of a site skill list', value: 100, unit: 'records', over: 'the rest are not read', range: [10, 1000] },
  historyAttach: { label: 'Saved conversation attached (# or auto)', value: 6000, unit: 'characters', over: 'its transcript is cut, with a note', range: [1000, 50000] },
  memory: {
    label: 'Memory index (in the system prompt, and the one for the open site)',
    value: 4000,
    unit: 'characters',
    over: 'the rest of the index is left out, with a note (memory__search still finds them; those of the open site go with a later message); the items sent in full are never cut',
    range: [500, 50000],
  },
  imagesPerMessage: { label: 'Images attached to a message', value: 4, unit: 'images', over: 'the rest are not attached (the message box says so)', range: [1, 10] },
  imageSize: { label: 'Attached image, longest side', value: 1568, unit: 'pixels', over: 'made smaller (and sent as JPEG) before it goes', range: [512, 4096] },
  mentions: { label: '::site mentions per message', value: 3, unit: 'mentions', over: 'the rest are not read (the message box warns)', range: [1, 10] },
  toolResult: { label: 'Tool result', value: 8000, unit: 'characters', over: 'cut, with a note', range: [2000, 200000] },
  pageText: { label: 'Page text (browser__get_page_text)', value: 7000, unit: 'characters', over: 'cut, with a note (the model can ask for another size)', range: [2000, 100000] },
  actionPageText: { label: 'Page text for a page widget action ({{page}})', value: 10000, unit: 'characters', over: 'cut, with a note', range: [2000, 100000] },
  structuredData: { label: 'Structured data (browser__get_structured_data)', value: 15000, unit: 'characters', over: 'cut, with a note', range: [2000, 200000] },
  findInDomMatches: { label: 'Matches listed by browser__find_in_dom', value: 20, unit: 'elements', over: 'the rest are counted, not listed', range: [5, 200] },
  // A page writes these into the tool definitions of every request: lowered only.
  webmcpTools: { label: 'WebMCP tools a page can offer', value: 25, unit: 'tools', over: 'the rest are not offered', range: [1, 25] },
  // Fixed: page-written text that goes to the model outside any untrusted block.
  webmcpDescription: { label: 'WebMCP tool description', value: 1000, unit: 'characters', over: 'cut' },
  webmcpSchema: { label: 'WebMCP tool parameters (JSON schema)', value: 4000, unit: 'characters', over: 'the tool is offered without parameters' },
  webmcpResult: { label: 'WebMCP tool result', value: 20000, unit: 'characters', over: 'cut, with a note', range: [2000, 200000] },
  recording: { label: 'Recording of requests sent with a message', value: 30000, unit: 'characters', over: 'the calls that do not fit go without their bodies, with a note', range: [5000, 200000] },
  attachedFile: { label: 'Attached file (Attach → File…)', value: 20000, unit: 'characters', over: 'cut, with a note', range: [2000, 200000] },
  tabAudio: { label: "Transcript of a tab's audio sent with a message", value: 20000, unit: 'characters', over: 'cut, with a note (the model can read on)', range: [2000, 200000] },
  tabAudioMinutes: { label: "How long a tab's audio is captured", value: 60, unit: 'minutes', over: 'the capture stops, as with Stop', range: [1, 240] },
  waitFor: { label: 'Waiting on a page (browser.wait_for)', value: 120, unit: 'seconds', over: 'it stops waiting and says what has not happened', range: [10, 600] },
  watches: { label: 'Tab watches running at once (browser.watch)', value: 5, unit: 'watches', over: 'a new one is refused', range: [1, 20] },
  panelAgents: {
    label: 'Agents a conversation starts in the Agents Panel (panel.start)',
    value: 3,
    unit: 'agents',
    over: 'a new one is refused until one of its rows is removed',
    range: [1, 10],
  },
  panelNotices: {
    label: 'Times the agents it started wake a conversation of the Agents Panel, until you write',
    value: 5,
    unit: 'notices',
    over: 'the next notice waits for your next message (0: never woken)',
    range: [0, 20],
  },
  // A stalled model request would hold its run for ever (an Agents Panel row, a sub-agent).
  modelFirstByte: { label: "Waiting for a model's answer to start", value: 120, unit: 'seconds', over: 'the request is given up with an error', range: [30, 900] },
  modelIdle: { label: "Silence in the middle of a model's answer", value: 60, unit: 'seconds', over: 'the request is given up with an error', range: [15, 600] },
  // Each piece of a text read aloud is a request to the voice's server: a whole page selected would be hundreds.
  speakText: { label: 'Text read aloud at a time (Speak)', value: 20000, unit: 'characters', over: 'the rest is not read, and the pill says so', range: [500, 200000] },
  scriptTime: { label: 'Time of a script tool', value: 30, unit: 'seconds', over: 'the script stops with an error', range: [5, 300] },
  scriptSteps: { label: 'Steps of a script tool (tool())', value: 30, unit: 'steps', over: 'the script stops with an error', range: [1, 100] },
  scriptStepsTime: { label: 'Time of a script tool that calls tools', value: 300, unit: 'seconds', over: 'the script stops with an error', range: [30, 1800] },
  screenshotSize: { label: 'Screenshot (browser__screenshot), longest side', value: 1568, unit: 'pixels', over: 'made smaller before it goes', range: [512, 4096] },
  pageTextMax: { label: 'Page text a call may ask for (browser__get_page_text maxChars)', value: 50000, unit: 'characters', over: 'a larger maxChars comes to this', range: [5000, 500000] },
  summaryText: { label: 'Conversation sent to be summarized (Compaction)', value: 60000, unit: 'characters', over: 'its oldest part is left out', range: [5000, 500000] },
  pinnedMemory: {
    label: 'Pinned memory items, sent in full',
    value: 8000,
    unit: 'characters',
    over: 'the pinned items that do not fit go in the memory index instead (memory__read reads them)',
    range: [500, 50000],
  },
  siteMemoryItems: { label: 'Memory items for the open site sent in full, per message', value: 20, unit: 'items', over: 'the rest go by title, and whole with a later message', range: [1, 200] },
  aboutUser: {
    label: 'About you (where {{about_user}} is)',
    value: 4000,
    unit: 'characters',
    over: 'the end is cut, with a note',
    range: [500, 20000],
  },
  watchMinutes: { label: 'How long a tab watch runs (browser.watch)', value: 60, unit: 'minutes', over: 'it ends, and you are told', range: [1, 720] },
  planReminder: { label: 'Tool calls between plan reminders (since the model last showed its plan)', value: 8, unit: 'tool calls', over: 'the model is sent its plan with the steps left, to check it still follows it', range: [2, 50] },
  planReminderAlways: { label: 'Tool calls between plan reminders, even after updates (0: off)', value: 20, unit: 'tool calls', over: 'the model is sent its plan, even if it updated it meanwhile', range: [0, 100] },
};

let overrides: Partial<Record<LimitId, number>> = {};

export function setLimitOverrides(o: Partial<Record<LimitId, number>> | undefined): void {
  overrides = o ?? {};
}

// The value in force: the one set in Settings (within its range) or the default.
export const limit = (id: LimitId): number => limitFrom(id, overrides[id]);

// What a tool result may carry of a text it wraps (a part read on, an answer, markup): the tool
// result limit, less room for the block around it.
const WRAP_ROOM = 300;
export const wrappedResultMax = () => limit('toolResult') - WRAP_ROOM;

// What a read of a page's text carries when the call asks for no size: the default, at most what a
// call may ask for.
export const pageTextDefault = () => Math.min(limit('pageText'), limit('pageTextMax'));

// What a value set for it comes to: within its range, else the default.
export function limitFrom(id: LimitId, set: number | undefined): number {
  const def = LIMIT_DEFS[id];
  if (!def.range || set === undefined || !Number.isFinite(set)) return def.value;
  return Math.min(def.range[1], Math.max(def.range[0], Math.round(set)));
}

const n = (x: number) => x.toLocaleString('en-US');

// "4,000 characters"
export const limitText = (id: LimitId) => `${n(limit(id))} ${LIMIT_DEFS[id].unit}`;

// What a cut says in the chat and Layers: where it was cut and of how much ("of" when known).
export function cutDetail(id: LimitId, total?: number, max = limit(id)): string {
  const { label, unit } = LIMIT_DEFS[id];
  return `${label}: cut at ${n(max)}${total !== undefined ? ` of ${n(total)}` : ''} ${unit}`;
}
