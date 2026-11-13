// A chat's session: what it runs, the questions it waits on. Bound to the port of the chat that
// opened it. The chat floating on a page loses its port when the page reloads or the agent moves
// it on: its run then goes on a while, away (`detached`), for the chat to take it over when it
// opens there again (`attach`): it is sent the run's history and what came since. Any other chat
// gone stops its run, as does closing the floating chat or its tab (stopFloating). While it runs or
// is away, the service worker keeps itself awake (its own timers are not slowed down like those of
// a hidden page), and the tabs it uses are not discarded (tab-holds).
import { browser } from 'wxt/browser';
import { errorText } from '../core/errors';
import { PORT_NAME, type BackgroundToPanel, type ChatView, type PanelToBackground, type RunTagged } from '../core/protocol';
import { createQuestions } from '../core/questions';
import { isExtensionPage } from '../core/sender';
import { isObject } from '../core/util';
import type { Message, UserReply, UserRequest } from '../core/types';
import type { Answer, Decision } from '../policy/engine';
import { runAgent } from './agent-run';
import type { RunMessage } from './run-setup';
import { tabHolds } from '../watches/tab-holds';
import { keepAwake } from './keep-awake';
import { chatViewOf, sessionAlerts } from './session-alerts';
import { tracePanel } from './panel-trace';
import { appendToLog } from './session-log';
import type { ToolsFor } from './tool-catalog';
import { NO_TAB, RUNNING_CHATS, RUNS_ELSEWHERE, type RunningChats } from '../widget/protocol';

const DETACHED_MS = 60_000;

// The panel's replies, checked: anything but a known decision denies, and only `true` grants.
const DECISIONS = new Set<Decision>(['allow', 'always', 'session', 'deny']);
// The edited values only as strings, by field.
export const confirmAnswer = (msg: { decision: unknown; comment?: unknown; edits?: unknown }): Answer => {
  const edits = isObject(msg.edits) ? Object.fromEntries(Object.entries(msg.edits).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};
  return {
    decision: DECISIONS.has(msg.decision as Decision) ? (msg.decision as Decision) : 'deny',
    ...(typeof msg.comment === 'string' && { comment: msg.comment }),
    ...(Object.keys(edits).length && { edits }),
  };
};
export const userReply = (reply: unknown): UserReply => {
  const answers = (reply as { answers?: unknown } | undefined)?.answers;
  return Array.isArray(answers) && answers.every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string')) ? { answers } : { dismissed: true };
};

type Session = ReturnType<typeof createSession>;

// What the sessions share: the tools, and the sessions there are.
interface Sessions {
  toolsFor: ToolsFor;
  sessions: Set<Session>; // those running, or away with what they ran
  detached: Map<string, Session>; // away, by conversation id
  publishRunning: () => void; // the conversations running changed (RUNNING_CHATS)
}

// What the user tools ask (tools/user). The signal closes the question in the panel unanswered.
function askUser(questions: ReturnType<typeof createQuestions<BackgroundToPanel>>, send: (m: BackgroundToPanel) => void) {
  return (request: UserRequest, signal?: AbortSignal) => {
    let id = '';
    const reply = questions.ask<UserReply>((qid) => {
      id = qid;
      return { type: 'user-request', id, request };
    }, { dismissed: true });
    signal?.addEventListener('abort', () => {
      if (!questions.isWaiting(id)) return;
      questions.answer(id, 'user-request', { dismissed: true });
      send({ type: 'user-closed', id });
    }, { once: true });
    return reply;
  };
}

function createSession(first: Browser.runtime.Port, { toolsFor, sessions, detached, publishRunning }: Sessions) {
  let controller: AbortController | null = null;
  let client: Browser.runtime.Port | null = first;
  const tab = first.sender?.tab?.id; // the chat floats on that tab; none: the side panel
  let conversationId: string | undefined;
  let runs = 0; // the run going on, by its number
  let runId: number | undefined; // the panel's number for it, sent back with each event (RunTagged)
  let running = false;
  let start: Message[] = []; // the history the run started from
  let log: BackgroundToPanel[] = []; // what it sent since
  let dismissedPlans = new Set<string>(); // the plans taken away while it goes
  let away: ReturnType<typeof setTimeout> | undefined;
  const stayAwake = keepAwake();
  const alerts = sessionAlerts(tab);
  const tagged = (m: BackgroundToPanel, id = runId): RunTagged => (id === undefined ? m : { ...m, runId: id });
  // `id`: the run it comes from, when it may no longer be the latest.
  const send = (m: BackgroundToPanel, id = runId) => {
    if (running && id === runId) appendToLog(log, m);
    alerts.sent(m);
    try {
      client?.postMessage(tagged(m, id));
    } catch {
      // its chat is gone a moment: kept in the log
    }
  };
  // Questions waiting for the user in the panel (confirm an action, allow a site).
  const questions = createQuestions<BackgroundToPanel>(send, alerts.settled);
  const { answer, denyAll: denyPending } = questions;
  const interact = askUser(questions, send);

  const cancelAway = () => {
    clearTimeout(away);
    away = undefined;
    stayAwake(running);
    if (conversationId && detached.get(conversationId) === session) detached.delete(conversationId);
  };
  const stopAll = () => {
    controller?.abort();
    denyPending();
    cancelAway();
    sessions.delete(session);
    publishRunning();
  };
  // Its chat's port closed: a floating chat's run goes on away; any other stops.
  const release = (port: Browser.runtime.Port) => {
    if (port !== client) return; // one that took it over has it
    client = null;
    alerts.connected(false);
    if (!running || tab === undefined || !conversationId) return stopAll();
    detached.set(conversationId, session);
    away = setTimeout(stopAll, DETACHED_MS);
    stayAwake(true);
  };
  // A chat takes it over: the run's history, then what it sent since (only the questions still
  // waiting), then on as it goes.
  const bind = (port: Browser.runtime.Port, view: ChatView | undefined) => {
    cancelAway();
    client = port;
    alerts.connected(true);
    alerts.view(view);
    const waiting = (m: BackgroundToPanel) => !(m.type === 'confirm' || m.type === 'access' || m.type === 'user-request' || m.type === 'more-steps') || questions.isWaiting(m.id);
    port.postMessage(tagged({ type: 'resume', history: start }));
    for (const m of log.filter(waiting)) port.postMessage(tagged(m));
    if (!running) finished();
  };
  const finished = () => {
    log = [];
    sessions.delete(session);
  };
  const handle = async (msg: PanelToBackground) => {
    if (msg.type === 'keepalive' || msg.type === 'attach') return; // keepalive: receiving it is the point
    if (msg.type === 'view') return alerts.view(chatViewOf(msg));
    if (msg.type === 'stop') {
      controller?.abort();
      publishRunning(); // stopped: another chat may run the conversation while this one unwinds
      return denyPending();
    }
    if (msg.type === 'plan-dismissed') {
      dismissedPlans.add(msg.id);
      // A chat that takes the run over is told, with the rest.
      if (running) appendToLog(log, msg);
      return;
    }
    if (msg.type === 'confirm-reply') return answer(msg.id, 'confirm', confirmAnswer(msg));
    if (msg.type === 'access-reply') return answer(msg.id, 'access', msg.granted === true);
    if (msg.type === 'user-reply') return answer(msg.id, 'user-request', userReply(msg.reply));
    if (msg.type === 'more-steps-reply') return answer(msg.id, 'more-steps', msg.more === true);
    if (msg.type !== 'run') return; // an unknown message (another version of the panel) never starts a run
    // One conversation, one run at a time: another chat's (the pinned conversation, floating on two
    // tabs) is not raced. This chat's own run goes on as before (replaced by its newer one).
    const asked = typeof msg.runId === 'number' ? msg.runId : undefined;
    const elsewhere = [...sessions].some((s) => s !== session && s.runningOn() === msg.conversationId);
    if (msg.conversationId && elsewhere) return void client?.postMessage(tagged({ type: 'error', error: RUNS_ELSEWHERE }, asked));
    const mine = ++runs;
    alerts.runStarts();
    runId = asked;
    const ownId = runId;
    // Made at once, so that a Stop (or a newer run) while the tabs are held stops this one.
    controller?.abort();
    const own = (controller = new AbortController());
    running = true;
    start = msg.history;
    log = [];
    dismissedPlans = new Set();
    conversationId = msg.conversationId;
    sessions.add(session);
    publishRunning();
    stayAwake(true);
    let releaseTabs: (() => Promise<void>) | undefined;
    try {
      releaseTabs = await tabHolds.holdForRun([tab, msg.tabId]);
      if (!own.signal.aborted && mine === runs) await run(msg, own, ownId);
    } catch (e) {
      console.error('[agent]', e);
      send({ type: 'error', error: errorText(e) }, ownId);
    } finally {
      void releaseTabs?.();
      if (mine === runs) {
        running = false;
        stayAwake(!!away);
        if (client) finished(); // with no chat, kept for it to take the run over
        publishRunning();
      }
    }
  };

  async function run(msg: RunMessage, own: AbortController, id: number | undefined) {
    const startedAt = Date.now(); // the response time counts reading the page too
    // Once stopped (or replaced by a new run), nothing more from this run reaches the panel: it
    // has already kept what it showed.
    const sendWhileRunning = (m: BackgroundToPanel) => !own.signal.aborted && send(m, id);
    await runAgent(msg, { toolsFor, signal: own.signal, send: sendWhileRunning, questions, interact, startedAt, dismissedPlans });
  }

  // The port went to a run away (attach): this one never had a run, nor will.
  const drop = () => alerts.connected(false);
  // The conversation it runs now (not once stopped: what is left of it only unwinds).
  const runningOn = () => (running && !controller?.signal.aborted ? conversationId : undefined);
  const session = { tab, handle, release, bind, stopAll, drop, runningOn };
  return session;
}

export function createSessions(toolsFor: ToolsFor) {
  // The conversations running now, for the chats that show one another runs (RUNNING_CHATS): none
  // when the worker starts, its runs gone with the one before.
  // Written only when it changed; the first time (the worker started), always.
  let written: string | undefined;
  const publishRunning = () => {
    const running: RunningChats = {};
    for (const s of shared.sessions) {
      const id = s.runningOn();
      if (id) running[id] = s.tab ?? NO_TAB;
    }
    const now = JSON.stringify(running);
    if (now === written) return;
    written = now;
    const write = now !== '{}' ? browser.storage.session.set({ [RUNNING_CHATS]: running }) : browser.storage.session.remove(RUNNING_CHATS);
    void write.catch((e: unknown) => console.error('[agent]', e));
  };
  const shared: Sessions = { toolsFor, sessions: new Set(), detached: new Map(), publishRunning };
  publishRunning();
  const stopFloating = (tabId: number) => {
    for (const s of shared.sessions) if (s.tab === tabId) s.stopAll();
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    if (!isExtensionPage(port.sender)) return port.disconnect(); // the chat's port: never a page's content script
    let session = createSession(port, shared);
    let view: ChatView | undefined; // as the chat last said, for a run away it takes over
    port.onDisconnect.addListener(() => session.release(port));
    port.onMessage.addListener((msg: PanelToBackground) => {
      if (msg.type === 'view') view = chatViewOf(msg);
      if (msg.type === 'run') tracePanel({ event: 'run', ...(view?.windowId !== undefined && { windowId: view.windowId }) }); // background/panel-trace
      if (msg.type === 'attach') {
        // Only the chat floating on the same tab takes a run away over.
        const away = shared.detached.get(msg.conversationId);
        const tab = port.sender?.tab?.id;
        if (!away || tab === undefined || away.tab !== tab) return;
        session.drop();
        session = away;
        away.bind(port, view);
        return;
      }
      void session.handle(msg);
    });
  });

  return { stopFloating };
}
