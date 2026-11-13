// What is handed to a chat through storage.session, and how the chat it is for takes it. The page
// widget hands a conversation (widget/protocol CHAT_HANDOFF), the popup and the shortcuts images
// (capture/protocol CHAT_ATTACH) and the background a tab's audio transcribed (audio/protocol, under the
// same key) or a stopped recording (recording/recorder-protocol RECORDING_HANDOFF): each an envelope
// {at, tab?, panelTab?, payload: {kind, …}}, routed to the chat floating on a tab, a tab's side panel, or
// none of them (the window's side panel), and taken by that chat (entrypoints/sidepanel/useHandoff),
// which removes it. One left waiting longer than its kind allows is dropped.

// Which chat it is for: the one floating on the tab, the tab's side panel (the chat's pin off: one per
// tab), or none of them (the window's side panel). `anyPanel`: addressed before the background knew the
// pin (a click that woke it): the side panel `panelTab` names or the window's, whichever opens. Only
// those given, so that storage never keeps an undefined one.
export interface HandoffTo {
  tab?: number;
  panelTab?: number;
  anyPanel?: true;
}
export const handoffTo = ({ tab, panelTab, anyPanel }: HandoffTo): HandoffTo => ({
  ...(tab !== undefined && { tab }),
  ...(panelTab !== undefined && { panelTab }),
  ...(anyPanel && { anyPanel }),
});

export interface Handoff<P> extends HandoffTo {
  at: number;
  payload: P;
}
export const handoff = <P>(payload: P, to: HandoffTo, at = Date.now()): Handoff<P> => ({ at, ...handoffTo(to), payload });

// One read back from storage.session, which another version of the extension may have written: its
// envelope checked here, its payload by `isPayload`.
export function isHandoff<P>(v: unknown, isPayload: (p: unknown) => p is P): v is Handoff<P> {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  const optional = (key: string) => h[key] === undefined || typeof h[key] === 'number';
  return typeof h.at === 'number' && optional('tab') && optional('panelTab') && (h.anyPanel === undefined || h.anyPanel === true) && isPayload(h.payload);
}

// How long one waits for its chat, unless its kind says otherwise (a recording: RECORDING_WAIT_MS).
export const HANDOFF_MS = 10 * 60_000;

// `tab`: the tab this chat floats on (none: a side panel); `panelTab`: the tab this side panel is
// opened on (none: the window's); `taken`: the time of the last one taken; `waitMs`: how long one
// waits before it is dropped; `idle`: given, one waits while it is false (no turn runs and nothing is
// being compacted: opening another conversation would stop it).
// none: not this chat's, or taken already; wait: left in storage until the chat is idle.
export function handoffStep<P>(h: unknown, isPayload: (p: unknown) => p is P, at: { tab: number | undefined; panelTab?: number; taken: number; now: number; waitMs: number; idle?: boolean }): { step: 'none' | 'wait' | 'drop' } | { step: 'take'; handoff: Handoff<P> } {
  if (!isHandoff(h, isPayload) || h.at === at.taken || h.tab !== at.tab) return { step: 'none' };
  if (h.panelTab !== at.panelTab && !(h.anyPanel && at.panelTab === undefined && at.tab === undefined)) return { step: 'none' };
  if (at.now - h.at >= at.waitMs) return { step: 'drop' };
  if (at.idle === false) return { step: 'wait' };
  return { step: 'take', handoff: h };
}
