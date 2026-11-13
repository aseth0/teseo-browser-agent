// WebMCP: tools a website registers for agents (document.modelContext.registerTool).
// They live in the page's own JavaScript world, so they are listed and run with short
// functions injected into the MAIN world; nothing stays installed in the page.
// The page writes their names, descriptions and results: everything is untrusted.
import { browser } from 'wxt/browser';
import { limit } from '../core/limits';
import { TOOL_NAME } from '../core/tool-registry';
import { markPageData, stripMarks, text, truncate } from '../core/model-texts';
import type { JSONSchema, Tool } from '../core/types';
import { hostOf } from '../core/util';
import { argumentDetails } from '../core/argument-details';
import { errorText } from '../core/errors';
import { withTimeout } from './in-time';

interface PageToolInfo {
  name: string;
  title: string;
  description: string;
  inputSchema: string; // JSON, as the page provided it
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const CALL_TIMEOUT_MS = 60_000;
// Listing waits this long at most: a page whose getTools() never answers would hold every request.
const LIST_TIMEOUT_MS = 1500;
// The page's title for a tool, cut, in the confirmation card's details.
const TITLE_SHOWN = 120;

// --- Injected functions: self-contained, they run in the page (nothing imported is there: each has
// what it needs inside it). ---

async function listInPage(): Promise<Outcome<PageToolInfo[]>> {
  type Raw = { name: string; title?: string; description?: string; inputSchema?: unknown };
  const w = window as unknown as {
    document: { modelContext?: { getTools?: () => Promise<Raw[]> } };
    navigator: { modelContext?: { getTools?: () => Promise<Raw[]> }; modelContextTesting?: { listTools?: () => Promise<Raw[]> | Raw[] } };
  };
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  try {
    // Current spec: document.modelContext; earlier Chrome builds: navigator.*.
    const mc = w.document.modelContext ?? w.navigator.modelContext;
    const raw = mc?.getTools ? await mc.getTools() : ((await w.navigator.modelContextTesting?.listTools?.()) ?? []);
    const value = raw.map((t) => ({
      name: String(t.name),
      title: String(t.title ?? ''),
      description: String(t.description ?? ''),
      inputSchema: typeof t.inputSchema === 'string' ? t.inputSchema : JSON.stringify(t.inputSchema ?? {}),
    }));
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

async function callInPage(name: string, args: Record<string, unknown>, host: string): Promise<Outcome<string | null>> {
  type Raw = { name: string };
  type Execute = (t: Raw, input: string | object) => Promise<unknown>;
  const w = window as unknown as {
    document: { modelContext?: { getTools?: () => Promise<Raw[]>; executeTool?: Execute } };
    navigator: {
      modelContext?: { getTools?: () => Promise<Raw[]>; executeTool?: Execute };
      modelContextTesting?: { executeTool?: (name: string, json: string) => Promise<unknown> };
    };
  };
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  // The tab may have gone to another site while the user was asked: that site's tool is not the one allowed.
  if (location.host !== host) return { ok: false, error: `Not done: the tab is now on ${location.host || location.href}, not on ${host}, where the tool was allowed.` };
  try {
    const mc = w.document.modelContext ?? w.navigator.modelContext;
    let result: unknown;
    if (mc?.getTools && mc.executeTool) {
      const tool = (await mc.getTools()).find((t) => t.name === name);
      if (!tool) return { ok: false, error: `The page no longer offers the tool "${name}"` };
      // The input as JSON text, as Chrome 154 and earlier take it (an object fails there with "Failed
      // to parse input arguments"); a browser that takes only an object refuses the text before the
      // tool runs, so it is sent again as one. Never after the tool itself failed: it must not run twice.
      try {
        result = await mc.executeTool(tool, JSON.stringify(args));
      } catch (e) {
        if (!/parse input arguments|must be an object|not an object|is not of type 'object'/i.test(message(e))) throw e;
        result = await mc.executeTool(tool, args);
      }
    } else if (w.navigator.modelContextTesting?.executeTool) {
      result = await w.navigator.modelContextTesting.executeTool(name, JSON.stringify(args));
    } else {
      return { ok: false, error: 'The page no longer offers WebMCP tools' };
    }
    // null: the tool started a navigation.
    return { ok: true, value: result == null ? null : typeof result === 'string' ? result : JSON.stringify(result) };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

// --- Background side ---

// An error the page itself reported (the tool failed), as opposed to the injection failing.
class PageToolError extends Error {}

async function inMainWorld<A extends unknown[], R>(tabId: number, func: (...args: A) => Promise<Outcome<R>>, args: A): Promise<R> {
  const [res] = await browser.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  const out = res?.result;
  if (!out) throw new Error('No answer from the page');
  if (!out.ok) throw new PageToolError(markPageData(out.error, 'tool')); // the page's own words
  return out.value;
}

// Tools the page in this tab offers; none when it offers none or cannot be read.
export async function listPageTools(tabId: number): Promise<PageToolInfo[]> {
  try {
    const tools = await withTimeout(inMainWorld(tabId, listInPage, []), LIST_TIMEOUT_MS, () => []);
    return tools.filter((t) => TOOL_NAME.test(t.name)).slice(0, limit('webmcpTools')); // what a page can push into the request
  } catch {
    return [];
  }
}

// The page's schema goes to the model as the tool's parameters, outside any untrusted block: one
// too large (a page can write anything into it) is left out, and the tool offered without parameters;
// its free texts (descriptions, titles, examples, comments) are left out too, leaving the shape.
export function parseSchema(json: string): JSONSchema {
  const none = (): JSONSchema => ({ type: 'object', properties: {} });
  if (json.length > limit('webmcpSchema')) return none();
  try {
    const s = JSON.parse(json) as JSONSchema;
    return s && typeof s === 'object' && !Array.isArray(s) && s.type === 'object' ? (withoutTexts(s) as JSONSchema) : none();
  } catch {
    return none();
  }
}

const SCHEMA_TEXTS = new Set(['description', 'title', 'examples', '$comment']);
// Keywords whose value maps names to schemas: the names are the parameters', never left out.
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

function withoutTexts(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutTexts);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).flatMap(([key, value]): [string, unknown][] => {
      if (SCHEMA_TEXTS.has(key)) return [];
      if (SCHEMA_MAPS.has(key) && value && typeof value === 'object' && !Array.isArray(value)) {
        return [[key, Object.fromEntries(Object.entries(value).map(([name, schema]) => [name, withoutTexts(schema)]))]];
      }
      // Values, not schemas: kept as the page wrote them.
      if (key === 'enum' || key === 'const' || key === 'default') return [[key, value]];
      return [[key, withoutTexts(value)]];
    }),
  );
}

// A page tool as an agent tool. Always "write": it runs the page's own code, so it goes
// through the site policy and, by default, the user's confirmation.
export function pageTool(tabId: number, host: string, info: PageToolInfo): Tool {
  const title = info.title.slice(0, TITLE_SHOWN).trim();
  return {
    name: `webmcp.${info.name}`,
    // Not marked: tool definitions are listed in the panel and are not colored anywhere.
    description: stripMarks(text('webmcp.description', { host, description: info.description.slice(0, limit('webmcpDescription')) })),
    inputSchema: parseSchema(info.inputSchema),
    source: 'webmcp',
    group: `webmcp:${host}`,
    effect: 'write',
    // The summary names the tool by its checked name: the page's title, any length, could fake it.
    describe: async (args) => ({
      summary: `Run the page's tool "${info.name}"`,
      details: [...(title && title !== info.name ? [{ label: 'Title (from the page)', value: title }] : []), ...argumentDetails(args)],
    }),
    run: async (args, ctx) => {
      let result: string | null;
      try {
        const call = inMainWorld(tabId, callInPage, [info.name, (args ?? {}) as Record<string, unknown>, ctx.approvedHost ?? host]);
        result = await withTimeout(call, CALL_TIMEOUT_MS, () => {
          throw new Error('The page tool did not answer in time');
        });
      } catch (e) {
        // The injection failed because the frame went away mid-call: the tool navigated.
        const navigated = !(e instanceof PageToolError) && /frame|navigat|removed|closed/i.test(errorText(e));
        if (!navigated) throw e;
        result = null;
      }
      if (result === null) return { type: 'text', text: text('action.navigated') };
      return { type: 'text', text: text('result.webmcp', { tool: info.name, result: markPageData(truncate(result, 'webmcpResult'), 'tool') }) };
    },
  };
}

export async function pageTools(tabId: number, url: string | undefined): Promise<Tool[]> {
  const host = hostOf(url);
  return (await listPageTools(tabId)).map((t) => pageTool(tabId, host, t));
}
