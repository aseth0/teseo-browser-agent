// The Agents Panel's page that has a chat's row (`parent`), as the panel's tools reach it
// (agents/panel): each answer undefined when no page answered (none open, or none with that row).
import { DEFAULT_AGENT_ID } from '../agents/builtins';
import type { PanelPage } from '../agents/panel';
import { PANEL_ROWS, PANEL_SEND, PANEL_START } from '../core/protocol';
import { sendRuntime } from '../core/runtime';

const unanswered = <T>(p: Promise<T | undefined>) => p.catch(() => undefined); // no page listens

export const panelPageOf = (parent: string): PanelPage => ({
  start: ({ agent, message, url, max }) =>
    unanswered(sendRuntime({ type: PANEL_START, parent, ...(agent.id !== DEFAULT_AGENT_ID && { agentId: agent.id }), agentName: agent.name, message, url, max })),
  rows: async (rows) => (await unanswered(sendRuntime({ type: PANEL_ROWS, parent, ...(rows && { rows }) })))?.rows,
  send: (row, message) => unanswered(sendRuntime({ type: PANEL_SEND, parent, row, message })),
});
