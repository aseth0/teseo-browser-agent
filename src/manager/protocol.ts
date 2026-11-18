// The agent manager's page and its chats (each an iframe of the chat app, sidepanel.html?tab=…&manager)
// talk with window.postMessage, on the extension's own origin only: the chat tells what it is doing
// as it changes (MANAGER_STATUS); the page asks it to stop its run before removing it (MANAGER_STOP),
// and the chat says once it has (MANAGER_STOPPED): removed while it runs, its run would go on away.
// A chat hidden by another row's selection is told (MANAGER_HIDDEN): it stops dictating. A chat started
// by another (agents/panel) is given its task and messages to send, in order, as it can (MANAGER_SAY).
export const MANAGER_STATUS = 'browser-agent:manager-status';
export const MANAGER_STOP = 'browser-agent:manager-stop';
export const MANAGER_STOPPED = 'browser-agent:manager-stopped';
export const MANAGER_HIDDEN = 'browser-agent:manager-hidden';
export const MANAGER_SAY = 'browser-agent:manager-say';

// As the floating chat tells its widget: waiting for the user (a card), working, or neither.
export type ChatActivity = 'idle' | 'working' | 'waiting';

export interface ManagerStatus {
  state: ChatActivity;
  said: boolean; // the conversation has a message (idle then reads "Done")
  conversationId: string;
  title: string;
  tabId?: number; // the page it works on
  url?: string;
  pageTitle?: string;
  step: number; // the model request of the turn, out of maxSteps
  maxSteps: number;
  lastTool?: string; // the turn's last tool call
  turnStartedAt?: number;
  agentId?: string; // none: Default
  agentName: string;
  model: string;
  given: number; // the messages the page gave it (MANAGER_SAY) that it has sent
  answer?: string; // its last reply, while no turn runs
}

// How a row started by another chat is, as panel.wait says it: answered (done), waiting for the user,
// working (or not yet at the messages it was given), or stopped (from the last time the page was open).
export type PanelRowState = 'done' | 'waiting' | 'working' | 'stopped';

// What the panel's page says of one of the rows a chat started (PANEL_ROWS).
export interface PanelRow {
  row: string;
  agent: string;
  state: PanelRowState;
  step?: number;
  maxSteps?: number;
  answer?: string; // its last reply, once it has read every message it was given
}

export type ChatToManager = { type: typeof MANAGER_STATUS; status: ManagerStatus } | { type: typeof MANAGER_STOPPED };
// A message an agent of the panel gives a chat it started: as the model gets it, and as the chat (and its
// row's title) shows it: the task or message alone.
export interface PanelMessage {
  text: string;
  shown: string;
  title?: string; // its row's title, when not what it shows (a brief: its task); none in rows saved before
  notice?: boolean; // the panel tells the chat an agent it started answered, or waits for the user (manager/notices)
}

export type ManagerToChat = { type: typeof MANAGER_STOP } | { type: typeof MANAGER_HIDDEN } | ({ type: typeof MANAGER_SAY } & PanelMessage);

// A chat of the page, working on that tab with that agent (none: Default), going on with that saved
// conversation (none: a new one).
// `row`: its key, which its runs carry (agents/panel); `parent`: the row that started it (its chat gets no
// panel tools).
export function chatUrl(tabId: number, agentId?: string, conversationId?: string, row?: { key: string; parent?: string }): string {
  const params = [
    `tab=${tabId}`,
    'manager',
    agentId && `agent=${encodeURIComponent(agentId)}`,
    conversationId && `conversation=${encodeURIComponent(conversationId)}`,
    row && `row=${encodeURIComponent(row.key)}`,
    row?.parent && `parent=${encodeURIComponent(row.parent)}`,
  ];
  return `sidepanel.html?${params.filter(Boolean).join('&')}`;
}
