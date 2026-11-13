// The top bar's tab watches (browser.watch): those running, with the time left and Cancel, and those
// ended since, until dismissed. Shown only while there is one.
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { text } from '../../core/model-texts';
import { WATCH_CANCEL } from '../../core/protocol';
import { sendRuntime } from '../../core/runtime';
import { watchKey } from '../../storage/watch';
import { Icon } from '../../ui/chat-icons';
import { Popover } from '../../ui/Popover';
import { useHeldConversations } from '../../ui/useHeld';
import { useStableCallback } from '../../ui/useStableCallback';
import { addEnded, dismissEnded, endText, takeEnded, loadEndedWatches, loadWatches, watchCondition, WATCHES_ENDED_KEY, WATCHES_KEY, type EndedWatch, type Watch } from '../../watches/store';

function useWatches() {
  const [running, setRunning] = useState<Watch[]>([]);
  const [ended, setEnded] = useState<EndedWatch[]>([]);
  useEffect(() => {
    const reload = () => {
      void loadWatches().then(setRunning);
      void loadEndedWatches().then(setEnded);
    };
    reload();
    const offs = [watchKey('session', WATCHES_KEY, reload), watchKey('session', WATCHES_ENDED_KEY, reload)];
    return () => offs.forEach((off) => off());
  }, []);
  return { running, ended };
}

// A watch met that was set from this conversation, to go on with it: the first one, while the chat
// can send (`ready`). `send` gets its message (watch.ended) once this chat has taken it, and says
// whether it went; refused (a turn started meanwhile), the watch is put back, to go once the chat is
// ready again (not before: keyed on the watch's id, putting it back does not run this again).
export function useWatchContinuation(conversationId: string, ready: boolean, send: (message: string) => boolean | undefined | Promise<boolean | undefined>) {
  const { ended } = useWatches();
  const met = ended.find((e) => e.end.kind === 'met' && e.watch.continueChat && e.watch.conversationId === conversationId);
  const metId = met?.watch.id;
  const goOn = useStableCallback(async () => {
    if (!met || !(await takeEnded(met.watch.id))) return;
    const tab = await browser.tabs.get(met.watch.tabId).catch(() => undefined);
    if (!(await send(text('watch.ended', { id: met.watch.id, end: endText(met.end), tab_id: String(met.watch.tabId), url: tab?.url ?? met.watch.origin, condition: watchCondition(met.watch.spec) })))) await addEnded(met);
  });
  useEffect(() => {
    if (metId && ready) void goOn();
  }, [metId, ready, goOn]);
}

// A met watch's Continue: off while its conversation is open in another chat (it goes on there).
function ContinueButton({ conversationId, onOpen, openOff }: { conversationId: string; onOpen: (conversationId: string) => void; openOff?: OpenOff }) {
  const held = useHeldConversations().has(conversationId);
  return (
    <button className="menu-option" onClick={() => onOpen(conversationId)} disabled={!!openOff || held}
      title={held ? 'Its conversation is open in another chat: go on with it there' : openOffTitle(openOff, 'Open its conversation: it goes on there')}>Continue</button>
  );
}

const minutesLeft = (w: Watch) => Math.max(0, Math.ceil((w.expiresAt - Date.now()) / 60_000));

// `onOpen`: the conversation a met watch goes on with, when it is not the one open (it then goes on).
// Why no other conversation opens now: a turn runs in the open one, or it is being compacted.
export type OpenOff = 'busy' | 'compacting';
// What a button that opens a conversation says while it cannot (compacting), or `otherwise`.
export const openOffTitle = (openOff: OpenOff | undefined, otherwise: string) => (openOff === 'compacting' ? 'Not while this conversation is being compacted' : otherwise);

// `openOff`: not now, and why.
export function WatchesMenu({ currentId, onOpen, openOff }: { currentId: string; onOpen: (conversationId: string) => void; openOff?: OpenOff }) {
  const { running, ended } = useWatches();
  if (!running.length && !ended.length) return null;
  const title = `Tab watches: ${running.length} running${ended.length ? `, ${ended.length} ended` : ''}`;
  return (
    <Popover title={title} className="watch-button" label={<><Icon name="watch" size={16} />{ended.length > 0 && <span className="watch-dot" aria-hidden />}</>}>
      {() => (
        <div className="menu watches-menu" aria-label="Tab watches">
          {running.map((w) => (
            <div key={w.id} className="watch-row">
              <div className="watch-text">
                <strong>{w.title}</strong>
                <span className="hint">{watchCondition(w.spec)} · {minutesLeft(w)} min left{w.setBy === 'agent' ? ' · set by the agent' : ''}</span>
              </div>
              <button className="menu-option" onClick={() => void sendRuntime({ type: WATCH_CANCEL, id: w.id })}>Cancel</button>
            </div>
          ))}
          {ended.map((e) => (
            <div key={e.watch.id} className="watch-row ended">
              <div className="watch-text">
                <strong>{e.watch.title}</strong>
                <span className="hint">{e.end.kind === 'met' ? 'Met: ' : 'Ended: '}{endText(e.end)}</span>
              </div>
              {e.end.kind === 'met' && e.watch.continueChat && e.watch.conversationId && e.watch.conversationId !== currentId && (
                <ContinueButton conversationId={e.watch.conversationId} onOpen={onOpen} openOff={openOff} />
              )}
              <button className="menu-option" onClick={() => void dismissEnded(e.watch.id)}>Dismiss</button>
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
