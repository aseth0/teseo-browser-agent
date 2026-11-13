// The tools a chat or an action is offered: the fixed ones, the MCP servers' (Settings → MCP
// servers), for a tab the tools its page offers (WebMCP), and the user's custom tools made from any
// of those; and the panel's catalog of them (LIST_TOOLS).
import { browser } from 'wxt/browser';
import { askTool } from '../agents/ask';
import { panelTools } from '../agents/panel';
import { agentTools } from '../agents/tools';
import { bookmarksAllowed } from '../bookmarks/store';
import { bookmarkTools } from '../bookmarks/tools';
import { bestEffort, errorText } from '../core/errors';
import { LIST_TOOLS, TOOLS_CHANGED, type ListToolsReply, type ToolInfo } from '../core/protocol';
import { onRuntime, sendRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { historyTools } from '../history/tools';
import { McpManager } from '../mcp/manager';
import { onSignInChanged } from '../mcp/oauth';
import { memoryTools } from '../memory/tools';
import { pageTools } from '../page/webmcp';
import { runScriptAway } from '../script/away';
import { skillTools } from '../skills/tools';
import type { Settings } from '../storage/settings';
import { templateTools } from '../templates/tools';
import { readTools } from '../tools/browser/read-tools';
import { watchTools } from '../tools/browser/watch-tools';
import { writeTools } from '../tools/browser/write-tools';
import { runtimeCustomTools } from '../tools/custom/runtime';
import { customToolStore } from '../tools/custom/store';
import { manageCustomTools } from '../tools/custom/manage';
import { ToolRegistry } from '../core/tool-registry';
import { userTools } from '../tools/user/user-tools';
import { engineToolsFor } from '../tools/browser/engine-tools';
import { SETTINGS_KEY } from '../storage/settings-types';
import { watchKey } from '../storage/watch';
import { devtoolsOn, settingChanged } from '../storage/settings-select';
import { askingFirst, webTools } from '../web/tools';
import { speechTools, type Say } from '../speech/tool';
import { actionTools } from '../widget/tools';
import { settingsNow } from './settings';
import { tabUrl } from './tabs';
import { speakAvailable } from '../core/build';

// The panel's catalog does not wait for slow MCP servers: it is told when they are in.
const LIST_WAIT_MS = 1500;

// The panels ask for the tools again.
const toolsChanged = () => void bestEffort(sendRuntime({ type: TOOLS_CHANGED }), 'tools-changed');

export type ToolsFor = ReturnType<typeof createToolCatalog>;

// `say`: speech.say's reading aloud (background/speech-host); not in the catalog where Speak is not
// available (core/build, tools/build-tools).
export function createToolCatalog(say: Say) {
  const tools = new ToolRegistry();
  // custom_tools.save checks a custom tool's base against what the tab is offered; actions.save, an
  // action's tool (a custom tool saved moments ago included).
  const catalog = async (tabId: number | undefined) => (await toolsFor(tabId, await settingsNow())).registry.list();
  for (const t of [...readTools(), ...watchTools(), ...writeTools(), ...userTools(), ...historyTools(), ...memoryTools(), ...webTools(), ...skillTools(), ...templateTools(), ...manageCustomTools(catalog, runScriptAway), ...actionTools(catalog), askTool(), ...panelTools(), ...agentTools(catalog), ...(speakAvailable() ? speechTools(say) : [])]) tools.register(t);

  // The MCP servers' tools (Settings → MCP servers): connected when first needed, and again when
  // the servers or the providers' keys change.
  const mcp = new McpManager();
  // Signed in or out (Settings → MCP servers): connected again with what there is now, and the
  // panels ask for the tools again.
  onSignInChanged(() => {
    mcp.reset();
    toolsChanged();
  });
  // Bookmarks allowed or no longer (Settings → Bookmarks): the panels ask for the tools again.
  browser.permissions.onAdded.addListener(toolsChanged);
  browser.permissions.onRemoved.addListener(toolsChanged);
  // Settings → Chromium DevTools turned on or off: the same.
  watchKey('local', SETTINGS_KEY, (change) => settingChanged(change, devtoolsOn) && toolsChanged());
  const mcpTools = async (settings: Settings, waitMs?: number, signal?: AbortSignal) => {
    mcp.keepOnly(settings.mcpServers ?? [], settings.providers);
    return mcp.tools(settings.mcpServers ?? [], settings.providers, waitMs, signal);
  };

  // The fixed tools, the MCP servers' and, for a tab, the tools its page offers (WebMCP); and the
  // MCP servers that could not be reached. With `waitMs`, the MCP servers still connecting are left
  // out (`mcpPending` settles when they are done); `signal`, a run's Stop, ends the wait for them.
  // Then the user's custom tools, made from any of those (tools/custom/runtime). Settings → Web search may
  // have every search confirmed first, also those of custom tools. `url`: the tab's, when the caller
  // has just read it.
  const toolsFor = async (tabId: number | undefined, settings: Settings, { waitMs, url, signal }: { waitMs?: number; url?: string; signal?: AbortSignal } = {}) => {
    const pageUrl = async (id: number) => url ?? tabUrl(id);
    const [fromPage, fromMcp, customs, bookmarks] = await Promise.all([tabId === undefined ? [] : pageTools(tabId, await pageUrl(tabId)), mcpTools(settings, waitMs, signal), customToolStore.load(), bookmarksAllowed()]);
    const search = tools.list().find((t) => t.name === 'web.search');
    const asking = settings.webSearch?.ask && search ? [askingFirst(search)] : [];
    // The bookmarks' tools only once the user allows them (Settings → Bookmarks); while Settings →
    // Chromium DevTools is on, the browser.* tools on the DevTools engine in place of the synthetic ones.
    const steady = tools.with([...fromMcp.tools, ...asking, ...(bookmarks ? bookmarkTools() : []), ...engineToolsFor(settings)]);
    const made = runtimeCustomTools(customs, [...steady.list(), ...fromPage], runScriptAway);
    // The page's own tools last: they change as the tab moves, and what goes before them stays the
    // same from request to request (the server's prompt cache), as run-setup's followPage keeps it.
    return { registry: steady.with([...made, ...fromPage]), mcpErrors: fromMcp.errors, mcpPending: fromMcp.pending };
  };

  onRuntime(LIST_TOOLS, (msg, sender) =>
    !isExtensionPage(sender) ? undefined :
    settingsNow().then((settings) => toolsFor(msg.tabId, settings, { waitMs: LIST_WAIT_MS })).then(({ registry: all, mcpPending }): ListToolsReply => {
      void mcpPending?.then(toolsChanged);
      return { tools: all.list().map(({ name, description, inputSchema, source, group, effect, repeatable, via }): ToolInfo => ({ name, description, inputSchema, source, group, effect, ...(repeatable && { repeatable }), ...(via && { via }) })) };
    }).catch((e): ListToolsReply => {
      console.error('[tools]', e);
      return { error: errorText(e) };
    }),
  );

  return toolsFor;
}
