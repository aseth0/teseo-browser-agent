// What the mock server saw or serves that the scenarios check or change.

export const apiCalls = []; // the requests to the items API, to see the page widget's cache at work
export const leaks = []; // requests from a script's sandbox to a site it must not reach
// What the source of custom tools (/tools/team.json) has: its tools, without their header values.
export const teamTool = (url) => ({ name: 'team.search', description: 'Searches the team items.', base: 'http', params: {}, group: 'Team API',
  inputs: [{ name: 'query', type: 'string', description: 'Words', required: true }],
  http: { method: 'GET', url, headers: [{ name: 'X-Key', value: '' }], extract: 'items[].title' } });
const initialMock = () => ({
  markedRequests: 0, // requests to the model that carried origin marks or cut notes
  lastAuthorization: undefined, // the Authorization header of the latest request to the model
  teamTools: [teamTool('http://localhost/api/items?q={query}')],
  replies: 0, // message-actions: numbers each reply, so a regenerated one differs
  refused: 0, // context-retry: every other request is refused as too long
  firstSystem: undefined, // memory-stable: the system prompt of the first turn
  transcriptions: [], // the chunks dictated (POST /audio/transcriptions): { model, prompt } each
  chatRequests: 0, // requests to /chat/completions
  speech: [], // the pieces asked to be read aloud (POST /audio/speech): its JSON body, and whether it was cut off (aborted)
  speechDelayMs: 300, // how long each piece takes, as a voice model on a CPU does
  embedded: [], // the texts sent to /embeddings, one array per request
});
export const mock = initialMock();
// The authorization server's state (mock/server oauth()).
const initialOauth = () => ({ token: 'secure-token', challenge: '', registered: 0, exchanged: 0 });
export const OAUTH = initialOauth();

// Before each scenario: nothing seen or changed by the one before.
export function resetMock() {
  Object.assign(mock, initialMock());
  Object.assign(OAUTH, initialOauth());
  apiCalls.length = 0;
  leaks.length = 0;
}
