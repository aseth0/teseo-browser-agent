import { useCallback, useEffect, useRef, type UIEvent } from 'react';
import type { Message } from '../../core/types';

// Follows new text: always, or only while the end is in view (Settings → Appearance). Your own
// message brings it to the end once, when it is added: the answer then streams into `live` while
// your message is still the last of the history (`follow`, called once streamed text is shown).
// Only the message list scrolls: scrollIntoView would also scroll whatever contains the panel
// (Settings → Appearance shows it in a frame).
// The message brought back to the composer (↑ ↓) is scrolled into view.
// What shows under the conversation without changing it (a card asking you, an error, the step
// limit's Continue) is followed the same way when `below` changes: brought into view unless you
// scrolled up.
export function useFollowScroll(history: Message[], followAlways: boolean, recalled: Message | undefined, below = '') {
  const listRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const followed = useRef(history);
  useEffect(() => {
    const list = listRef.current;
    const sent = history !== followed.current && history.at(-1)?.role === 'user';
    followed.current = history;
    if (list && (followAlways || atEnd.current || sent)) list.scrollTop = list.scrollHeight;
  }, [history, followAlways]);
  useEffect(() => {
    const list = listRef.current;
    if (list && below && (followAlways || atEnd.current)) list.scrollTop = list.scrollHeight;
  }, [below, followAlways]);
  const follow = useCallback(() => {
    const list = listRef.current;
    if (list && (followAlways || atEnd.current)) list.scrollTop = list.scrollHeight;
  }, [followAlways]);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector('.msg.recalled');
    if (list && el) list.scrollTop += el.getBoundingClientRect().top - list.getBoundingClientRect().top - 12;
  }, [recalled]);
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { listRef, onScroll, follow };
}
