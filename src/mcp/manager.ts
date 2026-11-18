// The MCP servers' tools for the agent, from the background: each enabled server is connected when a
// conversation starts (connect), before its first message, or the first time its tools are listed, and
// kept connected. A chat's message waits only for a server reached before in this browser's session
// (the worker started again); one that failed is left out at once, and tried again only when a new
// conversation starts, after a reset (a sign-in) or when its settings change.
// Its tools are mcp.<server>.<tool>; their descriptions, schemas and results come from the server:
// the descriptions go to the model introduced as the server's, the results inside an untrusted block,
// and none of them can open or close an untrusted block (their tags are neutralized).
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { browser } from 'wxt/browser';
import { markValue, neutralizeTags, stripMarks, text } from '../core/model-texts';
import { TOOL_NAME } from '../core/tool-registry';
import type { Tool, ToolResult } from '../core/types';
import type { ProviderConfig } from '../storage/settings';
import { argumentDetails } from '../core/argument-details';
import { mcpGroup, serverPolicyHost } from '../core/mcp-keys';
import { serverHeaders, type McpServerConfig } from './config';
import { connectMcp } from './connect';
import { oauthProvider, signInFlag, usesOAuth } from './oauth';
import { logMcp } from './logs';
import { fields } from '../tools/define';
import { errorText } from '../core/errors';

interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; title?: string };
}

interface Connected {
  client: Client;
  transport: string;
  tools: McpToolInfo[];
}

// Connects and lists the tools: what Settings' "Test" shows, and what the manager keeps. Signed in
// with OAuth when the server wants it and has no key of its own (never opening the sign-in page:
// SignInNeeded says so).
export async function connectAndList(server: McpServerConfig, headers: Record<string, string>): Promise<Connected> {
  const { client, transport } = await connectMcp(server.url, headers, usesOAuth(server) ? oauthProvider(server, false) : undefined);
  const { tools } = await client.listTools();
  return { client, transport, tools: tools.filter((t) => TOOL_NAME.test(t.name)) };
}

// The server's schema goes to the model as the tool's parameters: its free texts (descriptions,
// titles) cannot open or close an untrusted block either.
function neutralizeSchemaTexts(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(neutralizeSchemaTexts);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      (key === 'description' || key === 'title') && typeof value === 'string' ? neutralizeTags(stripMarks(value)) : neutralizeSchemaTexts(value),
    ]),
  );
}

// The server's title for a tool, cut, in the confirmation card's details.
const TITLE_SHOWN = 120;

// What a connection is made with: a server whose URL, headers or sign-in settings (OAuth) change gets
// another one.
const connectionKey = (server: McpServerConfig, headers: Record<string, string>) => `${server.url}\n${JSON.stringify(headers)}\n${JSON.stringify(server.oauth ?? {})}`;

// Whether a tool is confirmed like an action: every one is, unless the user trusts the server's
// read-only hints (Settings → MCP servers) and the server marks it read-only.
export const mcpToolEffect = (server: McpServerConfig, t: McpToolInfo): Tool['effect'] =>
  server.trustReadOnlyHints && t.annotations?.readOnlyHint ? 'read' : 'write';

// A failed call is made again on a new connection only when it surely did nothing: the server forgot
// the session (HTTP 404), or the tool only reads and the connection failed (closed, or the request
// never reached the server). Never on what the server answered (an error of its own, invalid params)
// nor on a timeout: the retry closes the shared connection, failing other chats' calls on it. A write
// that timed out may have been done already.
export const callAgainAfter = (e: unknown, effect: Tool['effect']): boolean => {
  const { code, name, message } = (e ?? {}) as { code?: unknown; name?: unknown; message?: unknown };
  if (code === 404) return true;
  const closed = name === 'McpError' && code === -32000 && typeof message === 'string' && /Connection closed$/.test(message); // the SDK's own
  return effect === 'read' && (closed || e instanceof TypeError); // TypeError: fetch failed (network)
};

// A server whose tools are not offered: why (signIn: it wants you signed in).
interface McpServerError {
  server: string;
  error: string;
  signIn?: boolean;
}

// A server has this long to connect: then it has failed, and a run waiting for it goes without its
// tools (the connection goes on: should it connect after all, its tools are offered from then on).
const RUN_CONNECT_MS = 15_000;

// A server's last failure. Remembered for the browser's session too (FAILED_KEY), so that a worker
// started again does not hold a message for a server already known not to answer.
interface Failure {
  at: number;
  error: string;
  signIn?: true;
}
const FAILED_KEY = 'mcpFailed';
// The servers that connected in this browser's session (by failureId): the only ones a chat's message
// waits for, when the worker started again and has to connect anew.
const REACHED_KEY = 'mcpReached';
// What a remembered failure is kept under: not the connection's key itself, which has the headers.
const failureId = (key: string) => {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `${key.length}.${h.toString(36)}`;
};
const TOO_SLOW = `it did not connect within ${RUN_CONNECT_MS / 1000} s`;
const isFailure = (v: unknown): v is Failure => !!v && typeof v === 'object' && typeof (v as Failure).at === 'number' && typeof (v as Failure).error === 'string';

// Settles undefined once `signal` aborts.
const aborted = (signal: AbortSignal) => new Promise<undefined>((resolve) => (signal.aborted ? resolve(undefined) : signal.addEventListener('abort', () => resolve(undefined), { once: true })));

export class McpManager {
  private connections = new Map<string, Promise<Connected>>(); // by url and headers
  private started = new Map<string, number>(); // by url and headers: when its connection began
  private failed = new Map<string, Failure>(); // by url and headers: the last failure
  private reached = new Set<string>(); // by failureId: those that connected in this browser's session
  // The failures remembered from before this worker started (by failureId): read once, as it starts.
  private before: Record<string, Failure> | undefined;
  private reading: Promise<void>;

  // `onBack`: a server that had failed connected (the panels list the tools again).
  constructor(private onBack: () => void = () => undefined) {
    this.reading = (async () => {
      try {
        const got = await browser.storage.session.get([FAILED_KEY, REACHED_KEY]);
        const reached: unknown = got[REACHED_KEY];
        if (Array.isArray(reached)) for (const id of reached) if (typeof id === 'string') this.reached.add(id);
        this.before ??= Object.fromEntries(Object.entries((got[FAILED_KEY] ?? {}) as Record<string, unknown>).filter((e): e is [string, Failure] => isFailure(e[1])));
      } catch {
        this.before ??= {};
      }
    })();
  }

  // The last failure of a connection: this worker's, else the one remembered from before it started
  // (while it has not tried the server itself).
  private lastFailure(key: string): Failure | undefined {
    const own = this.failed.get(key);
    if (own || this.connections.has(key)) return own;
    const remembered = this.before?.[failureId(key)];
    if (remembered) this.failed.set(key, remembered); // this worker's from now on
    return remembered;
  }

  private fail(key: string, e: unknown): void {
    this.failed.set(key, { at: Date.now(), error: errorText(e), ...signInFlag(e) });
    this.reached.delete(failureId(key));
    this.remember();
  }

  // It connected: waited for from now on, and back if it had failed.
  private connected(key: string): void {
    const back = this.failed.delete(key);
    const id = failureId(key);
    if (!back && this.reached.has(id)) return;
    this.reached.add(id);
    this.remember();
    if (back) this.onBack();
  }

  // This worker's failures replace the remembered ones: a server it reached is no longer one of them.
  private remember(): void {
    const all = Object.fromEntries([...this.failed].map(([key, f]) => [failureId(key), f]));
    this.before = {};
    try {
      void browser.storage.session.set({ [FAILED_KEY]: all, [REACHED_KEY]: [...this.reached] }).catch(() => undefined);
    } catch {
      // no storage here (a test): only this worker remembers
    }
  }

  // A new conversation starts: every enabled server not connected is connected, before its first
  // message, and one that failed is tried again (made anew if its connection was taking too long).
  async connect(servers: McpServerConfig[], providers: ProviderConfig[]): Promise<void> {
    if (!this.before) await this.reading;
    for (const server of servers.filter((s) => s.enabled)) {
      const headers = serverHeaders(server, providers);
      const key = connectionKey(server, headers);
      if (this.lastFailure(key) && this.connections.has(key)) this.drop(key);
      void this.connection(server, headers).catch(() => undefined);
    }
  }

  // The tools of the enabled servers, and the servers that could not be reached. With `waitMs`,
  // the servers still connecting after it are left out and `pending` settles once they are done;
  // without it (a run), one not connected within RUN_CONNECT_MS of its connection's start is an error.
  // `signal`: a run's Stop, after which none is waited for. `chat`: a chat's message, which waits only
  // for a server reached before in this session; one still connecting for the first time is left out.
  // A server whose last try failed is never waited for nor tried again here: it is an error at once.
  async tools(servers: McpServerConfig[], providers: ProviderConfig[], waitMs?: number, signal?: AbortSignal, chat = false): Promise<{ tools: Tool[]; errors: McpServerError[]; pending?: Promise<unknown> }> {
    const errors: McpServerError[] = [];
    const slow: Promise<unknown>[] = [];
    if (!this.before) await this.reading;
    const lists = await Promise.all(
      servers
        .filter((s) => s.enabled)
        .map(async (server) => {
          const headers = serverHeaders(server, providers);
          const key = connectionKey(server, headers);
          try {
            const recent = this.lastFailure(key);
            if (recent) {
              errors.push({ server: server.name, error: recent.error, ...(recent.signIn && { signIn: true }) });
              return [];
            }
            const holds = !chat || this.reached.has(failureId(key));
            const connection = this.connection(server, headers);
            const left = Math.max(0, (this.started.get(key) ?? 0) + RUN_CONNECT_MS - Date.now());
            let timer: ReturnType<typeof setTimeout> | undefined;
            const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), waitMs ?? (holds ? left : 0))));
            const ready = await Promise.race([connection, late, ...(signal ? [aborted(signal)] : [])]).finally(() => clearTimeout(timer));
            if (!ready) return []; // stopped
            if (ready === 'late' && waitMs !== undefined) {
              slow.push(connection.catch(() => undefined));
              return [];
            }
            if (ready === 'late' && !holds) throw new Error('it is still connecting');
            if (ready === 'late') {
              if (this.connections.get(key) === connection) this.fail(key, new Error(TOO_SLOW));
              throw new Error(TOO_SLOW);
            }
            return ready.tools.map((t) => this.tool(server, t, headers));
          } catch (e) {
            errors.push({ server: server.name, error: errorText(e), ...signInFlag(e) });
            return [];
          }
        }),
    );
    return { tools: lists.flat(), errors, ...(slow.length && { pending: Promise.all(slow) }) };
  }

  // Drops every connection: the next use connects again (e.g. after a sign-in).
  reset(): void {
    for (const key of [...this.connections.keys()]) this.drop(key);
    this.failed.clear();
    this.remember();
  }

  // Drops the connections no server of these settings uses (removed, or its URL, headers or sign-in changed):
  // two runs on settings a save apart do not close each other's servers.
  keepOnly(servers: McpServerConfig[], providers: ProviderConfig[]): void {
    const used = new Set(servers.filter((s) => s.enabled).map((s) => connectionKey(s, serverHeaders(s, providers))));
    for (const key of [...this.connections.keys()]) if (!used.has(key)) this.drop(key);
    // Nor is their failure kept: a server turned on again is tried again.
    let forgot = false;
    for (const key of [...this.failed.keys()]) if (!used.has(key)) forgot = this.failed.delete(key) || forgot;
    if (forgot) this.remember();
  }

  private drop(key: string): void {
    void this.connections.get(key)?.then(({ client }) => client.close()).catch(() => undefined);
    this.connections.delete(key);
    this.started.delete(key);
  }

  // Each new connection goes to the server's logs (Settings → MCP servers).
  private connection(server: McpServerConfig, headers: Record<string, string>): Promise<Connected> {
    const key = connectionKey(server, headers);
    let c = this.connections.get(key);
    if (!c) {
      const started = Date.now();
      c = connectAndList(server, headers);
      // One that takes too long has failed, for whoever asks next.
      const slow = setTimeout(() => this.connections.get(key) === c && this.fail(key, new Error(TOO_SLOW)), RUN_CONNECT_MS);
      c.then(
        ({ tools, transport }) => {
          clearTimeout(slow);
          if (this.connections.get(key) === c) this.connected(key);
          return logMcp({ at: Date.now(), server: server.name, kind: 'connect', ok: true, detail: `${tools.length} tools (${transport})`, ms: Date.now() - started, tools: tools.map((t) => t.name) });
        },
        (e: unknown) => {
          clearTimeout(slow);
          // Not one made since a reset.
          if (this.connections.get(key) === c) {
            this.connections.delete(key);
            this.started.delete(key);
            this.fail(key, e);
          }
          void logMcp({ at: Date.now(), server: server.name, kind: 'connect', ok: false, detail: errorText(e), ms: Date.now() - started, ...signInFlag(e) });
        },
      );
      this.connections.set(key, c);
      this.started.set(key, started);
    }
    return c;
  }

  private tool(server: McpServerConfig, t: McpToolInfo, headers: Record<string, string>): Tool {
    const title = (t.title ?? t.annotations?.title ?? '').slice(0, TITLE_SHOWN).trim();
    return {
      name: `mcp.${server.name}.${t.name}`,
      description: stripMarks(text('mcp.description', { server: server.name, description: t.description ?? '' })),
      inputSchema: neutralizeSchemaTexts(t.inputSchema) as Tool['inputSchema'],
      source: 'mcp',
      group: mcpGroup(server.name),
      effect: mcpToolEffect(server, t),
      policyHost: serverPolicyHost(server.name),
      // The summary names the tool by the name it is called with; the server's title goes in the details.
      describe: async (args) => ({
        summary: `Run the tool "${t.name}" of the MCP server ${server.name}`,
        details: [...(title && title !== t.name ? [{ label: 'Title (from the server)', value: title }] : []), ...argumentDetails(args)],
      }),
      run: async (args, ctx) => {
        let used: Promise<Connected> | undefined; // the connection the last try went on
        const call = async (): Promise<McpCallResult> => {
          used = this.connection(server, headers);
          const { client } = await used;
          const r = await client.callTool({ name: t.name, arguments: fields(args) }, undefined, { signal: ctx.signal, ...(server.toolTimeoutSeconds && { timeout: server.toolTimeoutSeconds * 1000 }) });
          // A server of the first protocol version answers { toolResult }: shown as structured content.
          return 'toolResult' in r ? { structuredContent: r.toolResult } : r;
        };
        const started = Date.now();
        const log = (ok: boolean, detail: string) => void logMcp({ at: Date.now(), server: server.name, kind: 'call', ok, detail, ms: Date.now() - started });
        let result: McpCallResult;
        try {
          try {
            result = await call();
          } catch (e) {
            if (ctx.signal.aborted || !callAgainAfter(e, mcpToolEffect(server, t))) throw e;
            // The session may have expired: connect again once. Unless another call did already: the
            // one there now is new, and others may be on it.
            const key = connectionKey(server, headers);
            if (this.connections.get(key) === used) this.drop(key);
            result = await call();
          }
        } catch (e) {
          log(false, `${t.name}: ${errorText(e)}`);
          throw e;
        }
        log(!result.isError, result.isError ? `${t.name}: the tool answered with an error` : t.name);
        return mcpResult(server.name, t.name, result);
      },
    };
  }
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string } }
  | { type: 'resource_link'; uri: string; name?: string }
  | { type: string };

interface McpCallResult {
  content?: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

// The answer as a value, kept apart for actions' steps and script tools (the model gets the block):
// its structured content, else its text when that is JSON.
function answerData(r: McpCallResult, body: string): unknown {
  if (r.structuredContent !== undefined) return r.structuredContent;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

// What the model gets: the server's text (or its structured content) in the untrusted block; an
// image alone goes as an image.
export function mcpResult(server: string, tool: string, r: McpCallResult): ToolResult {
  const content = r.content ?? [];
  const texts = content.flatMap((c) => {
    if (c.type === 'text' && 'text' in c) return [c.text];
    if (c.type === 'resource' && 'resource' in c) return [c.resource.text ?? `[resource ${c.resource.uri}]`];
    if (c.type === 'resource_link' && 'uri' in c) return [`[resource ${c.name ?? c.uri}: ${c.uri}]`];
    return [];
  });
  const image = content.find((c): c is Extract<McpContent, { type: 'image' }> => c.type === 'image' && 'data' in c);
  if (!texts.length && image && !r.isError) return { type: 'image', mediaType: image.mimeType, data: image.data };
  const body = texts.length ? texts.join('\n') : r.structuredContent !== undefined ? JSON.stringify(r.structuredContent, null, 1) : '';
  const data = r.isError ? undefined : answerData(r, body);
  return { type: 'text', text: text('result.mcp', { server, tool, result: markValue(stripMarks(body), 'mcp') }), isError: r.isError, ...(data !== undefined && { data }) };
}
