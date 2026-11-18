// The tools of the chat: those the tab is offered (with the page's own and the MCP servers'), and
// what the tools menus show and change, which with an agent are the agent's tools.
import { useEffect, useMemo } from 'react';
import { withAsk } from '../../agents/ask';
import { withPanel } from '../../agents/panel';
import { MANAGER_PANEL_ROW } from '../../ui/floating-frame';
import { agentOffers, agentStore, agentToolsFrom, callableAgents, type AgentProfile } from '../../agents/profiles';
import { isEmptyAgent } from '../../agents/builtins';
import type { Settings } from '../../storage/settings';
import { isOfferedGroup, useToolCatalog } from '../../ui/Tools';
import { toolGroup } from '../../core/tool-groups';
import type { SettingsUpdate } from '../../ui/useSettings';
import type { PageTarget } from './usePageTarget';
import { MCP_CONNECT } from '../../core/protocol';
import { sendRuntime } from '../../core/runtime';
import { bestEffort } from '../../core/errors';

// `fresh`: the conversation's id while it has no message yet.
export function useAgentTools(settings: Settings, onChange: SettingsUpdate, page: PageTarget, profile: AgentProfile | undefined, agents: AgentProfile[], fresh?: string) {
  const readable = page.access === 'ok';
  // A conversation starts: the MCP servers are connected before its first message, so that it waits for none.
  useEffect(() => {
    if (fresh) void bestEffort(sendRuntime({ type: MCP_CONNECT }), 'mcp-connect');
  }, [fresh]);
  // Again when the page or the MCP servers change (Settings → MCP servers).
  const servers = useMemo(() => JSON.stringify(settings.mcpServers ?? []), [settings.mcpServers]);
  const toolCatalog = useToolCatalog(readable ? page.tabId : undefined, `${readable ? page.url : ''}|${servers}`);
  const pageToolNames = useMemo(() => toolCatalog.filter((t) => t.source === 'webmcp').map((t) => t.name), [toolCatalog]);
  // Groups of tools that pages and servers offer, remembered once seen so they can be hidden from
  // the tools menu beforehand (Settings → Appearance → Chat).
  const newGroups = [...new Set(toolCatalog.map(toolGroup))].filter((g) => isOfferedGroup(g) && !(settings.chatView?.seenToolGroups ?? []).includes(g));
  const newGroupsKey = newGroups.join('\n');
  useEffect(() => {
    if (!newGroupsKey) return;
    onChange((s) => {
      const seen = s.chatView?.seenToolGroups ?? [];
      const unseen = newGroupsKey.split('\n').filter((g) => !seen.includes(g));
      return unseen.length ? { ...s, chatView: { ...s.chatView, seenToolGroups: [...seen, ...unseen] } } : s;
    });
  }, [newGroupsKey, onChange]);
  // With an agent, the tools menus show and change its tools; the rest of what they change (what
  // they hide) is the chat's.
  // agents.ask is listed only with someone to ask, as it is offered, and the Agents Panel's tools only
  // in a chat of the panel the user started (agents/panel); Default's, without the creating
  // tools while Builder has them.
  // EmptyAgent has none, nor can it be given any.
  // Made again only when what they come from changes, not on every render of the chat.
  const { menuTools, catalogNames, toolSettings } = useMemo(() => {
    const callable = callableAgents(profile, agents, settings);
    const listed = withAsk(profile ? toolCatalog : agentOffers(undefined, toolCatalog, agents), callable);
    const menuTools = isEmptyAgent(profile) ? [] : withPanel(listed, MANAGER_PANEL_ROW !== undefined && callable.length > 0);
    const catalogNames = menuTools.map((t) => t.name);
    const offeredNames = new Set(agentOffers(profile, menuTools, agents).map((t) => t.name));
    const toolSettings = profile ? { ...settings, disabledTools: catalogNames.filter((n) => !offeredNames.has(n)) } : settings;
    return { menuTools, catalogNames, toolSettings };
  }, [profile, toolCatalog, agents, settings]);
  const onToolSettings = (patch: Partial<Settings>) => {
    if (!profile) return onChange(patch);
    if (isEmptyAgent(profile)) return;
    const { disabledTools, ...rest } = patch;
    if (disabledTools) void agentStore.update(profile.id, (a) => ({ ...a, tools: agentToolsFrom(a, catalogNames, disabledTools) }));
    if (Object.keys(rest).length) onChange(rest);
  };
  return { toolCatalog, pageToolNames, menuTools, toolSettings, onToolSettings };
}
