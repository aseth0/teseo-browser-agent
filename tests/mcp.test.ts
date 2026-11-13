import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt } from '../src/context/request';
import { stripMarks } from '../src/core/model-texts';
import type { Tool } from '../src/core/types';
import { isMcpPolicyHost, mcpServerOf, serverPolicyHost } from '../src/core/mcp-keys';
import { exportServers, importServers, parseHeaders, serverHeaders, serverName, serverProblems, type McpServerConfig } from '../src/mcp/config';
import { callAgainAfter, mcpResult, mcpToolEffect } from '../src/mcp/manager';
import { offeredServers, providerRoot, providerServer } from '../src/mcp/provider';
import { authorize } from '../src/policy/engine';
import type { ProviderConfig, Settings } from '../src/storage/settings';
import { mockFetch } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const litellm: ProviderConfig = { id: 'p', name: 'LiteLLM', baseURL: 'https://llm.test/v1/', apiKey: 'sk-1', defaultModel: '' };

afterEach(() => vi.unstubAllGlobals());

describe('MCP servers', () => {
  it('are found on a LiteLLM provider and use its key without copying it', async () => {
    expect(providerRoot(litellm.baseURL)).toBe('https://llm.test');
    const fetchMock = mockFetch(new Response(JSON.stringify([{ server_name: 'GitHub', alias: 'github', description: 'Repos' }]), { status: 200 }));
    const offered = await offeredServers(litellm);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://llm.test/v1/mcp/server');
    expect(offered).toEqual([{ name: 'github', description: 'Repos', url: 'https://llm.test/github/mcp' }]);
    const server = providerServer(litellm, offered[0]);
    expect(server.headers).toEqual({ 'x-litellm-api-key': 'Bearer {{apiKey}}' });
    expect(serverHeaders(server, [litellm])).toEqual({ 'x-litellm-api-key': 'Bearer sk-1' });
    expect(providerServer(litellm).url).toBe('https://llm.test/mcp/'); // the gateway: all of them
  });

  it('are listed with the provider\'s own headers', async () => {
    const fetchMock = mockFetch(new Response('[]', { status: 200 }));
    await offeredServers({ ...litellm, extraHeaders: { 'x-team': 't1' } });
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer sk-1', 'x-litellm-api-key': 'Bearer sk-1', 'x-team': 't1' });
    await offeredServers({ ...litellm, extraHeaders: { 'api-key': '{{apiKey}}' } }); // a gateway that takes the key in its own header
    const headers = fetchMock.mock.calls[1]![1].headers;
    expect(headers).toMatchObject({ 'api-key': 'sk-1', 'x-litellm-api-key': 'Bearer sk-1' });
    expect(headers.Authorization).toBeUndefined();
  });

  it('are named by their policy key', () => {
    expect(mcpServerOf(serverPolicyHost('github'))).toBe('github');
    expect(isMcpPolicyHost('mcp:github')).toBe(true);
    expect([isMcpPolicyHost('mcp:'), isMcpPolicyHost('example.com'), isMcpPolicyHost(undefined)]).toEqual([false, false, false]);
    expect(mcpServerOf('webmcp:example.com')).toBeUndefined();
  });

  it('say why a provider offers none', async () => {
    mockFetch(new Response('', { status: 404 }));
    await expect(offeredServers(litellm)).rejects.toThrow('does not offer MCP servers');
  });

  it('import and export the mcpServers format; local servers are left for later', () => {
    const { servers, skipped } = importServers(JSON.stringify({ mcpServers: { 'My Notes': { url: 'https://n.test/mcp', headers: { a: 'b' } }, fs: { command: 'npx' } } }));
    expect(servers.map((s) => [s.name, s.url, s.enabled])).toEqual([['my_notes', 'https://n.test/mcp', false]]);
    expect(skipped).toEqual(['fs']);
    // Headers that are not texts are left out; a server whose url is not a text is skipped.
    const odd = importServers(JSON.stringify({ mcpServers: { a: { url: 'https://a.test/mcp', headers: { ok: 'x', n: 1, o: {} } }, b: { url: 5 }, c: null } }));
    expect(odd.servers.map((s) => s.headers)).toEqual([{ ok: 'x' }]);
    expect(odd.skipped).toEqual(['b', 'c']);
    expect(() => importServers('[]')).toThrow('No "mcpServers" object');
    expect(JSON.parse(exportServers(servers, true))).toEqual({ mcpServers: { my_notes: { type: 'http', url: 'https://n.test/mcp', headers: { a: 'b' } } } });
  });

  it("export without the headers' values unless asked; an empty one imported takes the value of a server at its URL", () => {
    const saved: McpServerConfig = { id: 's', name: 'gw', url: 'https://gw.test/mcp', enabled: true, headers: { Authorization: 'Bearer sk-secret', 'x-litellm-api-key': '{{apiKey}}' } };
    const json = exportServers([saved]);
    expect(json).not.toContain('sk-secret');
    expect(JSON.parse(json).mcpServers.gw.headers).toEqual({ Authorization: '', 'x-litellm-api-key': '{{apiKey}}' });
    expect(exportServers([saved], true)).toContain('Bearer sk-secret');
    expect(importServers(json, [saved]).servers[0]!.headers).toEqual(saved.headers);
    expect(importServers(json, [{ ...saved, url: 'https://other.test/mcp' }]).servers[0]!.headers).toEqual({ Authorization: '', 'x-litellm-api-key': '{{apiKey}}' });
  });

  it('wrap the results as untrusted MCP content; an image alone goes as an image', () => {
    const r = mcpResult('notes', 'echo', { content: [{ type: 'text', text: 'hi' }], isError: false });
    expect(r.type === 'text' && stripMarks(r.text)).toBe('<untrusted_mcp_content server="notes" tool="echo">\nhi\n</untrusted_mcp_content>');
    expect(mcpResult('s', 't', { content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }] })).toEqual({ type: 'image', mediaType: 'image/png', data: 'AAA' });
    const structured = mcpResult('s', 't', { structuredContent: { n: 1 }, isError: true });
    expect(structured.type === 'text' && structured.isError).toBe(true);
  });

  it('keep the answer apart as data: the structured content, else text that is JSON', () => {
    const json = mcpResult('s', 't', { content: [{ type: 'text', text: '{"ok": true, "data": {"score": 57}}' }] });
    expect(json.type === 'text' && json.data).toEqual({ ok: true, data: { score: 57 } });
    expect(json.type === 'text' && stripMarks(json.text)).toContain('<untrusted_mcp_content'); // the model's view is unchanged
    const structured = mcpResult('s', 't', { content: [{ type: 'text', text: 'Score: 57' }], structuredContent: { score: 57 } });
    expect(structured.type === 'text' && structured.data).toEqual({ score: 57 });
    expect(mcpResult('s', 't', { content: [{ type: 'text', text: 'plain' }] })).not.toHaveProperty('data');
    expect(mcpResult('s', 't', { content: [{ type: 'text', text: '{"error": 1}' }], isError: true })).not.toHaveProperty('data');
  });

  it('take headers only as a JSON object of texts, and send any stored otherwise as text', () => {
    expect(parseHeaders('{"Authorization": "Bearer {{apiKey}}"}')).toEqual({ headers: { Authorization: 'Bearer {{apiKey}}' } });
    expect(parseHeaders('')).toEqual({ headers: {} });
    expect(parseHeaders('[]')).toHaveProperty('problem');
    expect(parseHeaders('{"X-N": 1}')).toEqual({ problem: 'The header "X-N" must be a text, in quotes' });
    expect(parseHeaders('{oops')).toEqual({ problem: 'The headers are not valid JSON' });
    const stored = { id: 's', name: 's', url: 'https://m.test', enabled: true, headers: { 'X-N': 1 } as unknown as Record<string, string> };
    expect(serverHeaders(stored, [])).toEqual({ 'X-N': '1' });
  });

  it('call a tool again on a new connection only when the first call surely did nothing', () => {
    const expired = Object.assign(new Error('Error POSTing to endpoint: session not found'), { code: 404 });
    const timedOut = Object.assign(new Error('Request timed out'), { code: -32001 });
    expect(callAgainAfter(expired, 'write')).toBe(true);
    expect(callAgainAfter(timedOut, 'write')).toBe(false); // the server may have done it
    expect(callAgainAfter(new Error('tool failed'), 'write')).toBe(false);
    // A tool that only reads: again when the connection failed, never on what the server answered.
    const closed = Object.assign(new Error('MCP error -32000: Connection closed'), { name: 'McpError', code: -32000 });
    const serverSaid = Object.assign(new Error('MCP error -32000: quota used up'), { name: 'McpError', code: -32000 });
    const invalid = Object.assign(new Error('MCP error -32602: Invalid params'), { name: 'McpError', code: -32602 });
    expect(callAgainAfter(closed, 'read')).toBe(true);
    expect(callAgainAfter(new TypeError('Failed to fetch'), 'read')).toBe(true);
    expect(callAgainAfter(expired, 'read')).toBe(true);
    expect(callAgainAfter(timedOut, 'read')).toBe(false);
    expect(callAgainAfter(invalid, 'read')).toBe(false);
    expect(callAgainAfter(serverSaid, 'read')).toBe(false);
    expect(callAgainAfter(new Error('tool failed'), 'read')).toBe(false);
    expect(callAgainAfter(closed, 'write')).toBe(false);
  });

  it("treat the server's read-only hint as untrusted unless the user trusts it", () => {
    const server = { id: '1', name: 'notes', url: 'https://n.test/mcp', enabled: true };
    const hinted = { name: 'list', inputSchema: {}, annotations: { readOnlyHint: true } };
    expect(mcpToolEffect(server, hinted)).toBe('write');
    expect(mcpToolEffect({ ...server, trustReadOnlyHints: true }, hinted)).toBe('read');
    expect(mcpToolEffect({ ...server, trustReadOnlyHints: true }, { name: 'add', inputSchema: {} })).toBe('write');
  });

  it("follow the server's policy, not the tab's site", async () => {
    const tool = { name: 'mcp.notes.add', description: '', inputSchema: {}, source: 'mcp', effect: 'write', policyHost: 'mcp:notes', run: async () => ({ type: 'text', text: '' }) } as Tool;
    const asked: string[] = [];
    const deps = {
      getPolicy: async (host: string) => (host === 'mcp:notes' ? ('auto' as const) : ('ask' as const)),
      setPolicy: async () => {},
      tabUrl: async () => 'https://shop.test/',
      confirm: async (q: { host: string }) => {
        asked.push(q.host);
        return { decision: 'deny' as const };
      },
    };
    expect(await authorize(deps, tool, {}, { settings: TOOL_SETTINGS, signal: new AbortController().signal })).toEqual({});
    expect(asked).toEqual([]);
  });

  it('add the untrusted MCP rule to the system prompt when a server is on', () => {
    const settings = { providers: [], systemPrompt: '', mcpServers: [{ id: 'm', name: 'notes', url: 'https://n.test/mcp', enabled: true }] } as Settings;
    expect(buildSystemPrompt({ settings, skills: [], templates: [] })).toContain('<untrusted_mcp_content>');
    expect(buildSystemPrompt({ settings: { ...settings, mcpServers: [] }, skills: [], templates: [] })).not.toContain('untrusted_mcp_content');
  });
});

describe('serverProblems', () => {
  const saved: McpServerConfig[] = [{ id: 'a', name: 'notes', url: 'https://n.test/mcp', enabled: true }];
  it('refuses a name another server has, not its own', () => {
    expect(serverProblems({ id: 'b', name: 'notes', url: 'https://m.test/mcp', enabled: true }, saved)).toEqual(['Another server already has this name.']);
    expect(serverProblems(saved[0]!, saved)).toEqual([]);
  });
  it('refuses "__" in a name (a server saved with one, until renamed); names made here have none', () => {
    const odd: McpServerConfig = { id: 'c', name: 'a__b', url: 'https://c.test/mcp', enabled: true };
    expect(serverProblems(odd, [...saved, odd])).toEqual(['A server name can\'t contain "__".']);
    expect(serverProblems({ ...odd, name: 'a_b' }, [...saved, odd])).toEqual([]);
    expect(serverName('My  __ Notes')).toBe('my_notes');
    expect(importServers(JSON.stringify({ mcpServers: { 'a__b': { url: 'https://c.test/mcp' } } })).servers[0]!.name).toBe('a_b');
  });
  it('wants a name and an http(s) URL', () => {
    expect(serverProblems({ id: 'b', name: '', url: 'ftp://m.test', enabled: true }, saved)).toHaveLength(2);
  });
});
