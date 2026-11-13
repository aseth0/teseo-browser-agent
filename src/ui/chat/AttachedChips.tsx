// What went with a message besides its text, as chips and small pills (ui/chat/MessageView), and what
// went after a tool's result between the model's steps (ui/chat/ToolCallView).
import { useContext, useEffect, useState } from 'react';
import { bookmarkUrl } from '../../bookmarks/store';
import { bookmarkAutoOf, fileOf, historyAutoOf, recordingOf } from '../../context/sources';
import type { Message } from '../../core/types';
import { Icon, type ChatIconName } from '../chat-icons';
import { ChatActionsContext } from './contexts';
import { replacedInMessage, replacedInResult, ReplacedContext, type ReplacedView } from './replaced';
import { memoryAttached, memoryAutoAttached, memoryIndexAttached, stepAttached, webUrlOf, type ToolResultPart } from './turns';

// What went with a message besides its text: the files and recordings you attached, and the groups of
// what went on its own (auto-attach, memory, site skills), then what the word blacklist replaced in it.
export function messageAttached(message: Message, openMemory?: () => void, replaced?: ReplacedView): { files: string[]; recorded: { site: string; calls: number }[]; groups: AutoGroup[] } {
  const sources = message.parts.map((p) => (p.type === 'text' ? p.source : undefined));
  const auto = sources.flatMap((s) => historyAutoOf(s) ?? []);
  const autoBookmarks = sources.flatMap((s) => bookmarkAutoOf(s) ?? []);
  const memory = memoryAttached(message);
  const memoryAuto = memoryAutoAttached(message);
  // The site skills whose rules went with it (the later messages on the site get only a reminder).
  const siteSkills = message.parts.flatMap((p) => (p.type === 'text' && p.context === 'skill' && p.source ? [p.source] : []));
  const masked = replaced && replacedInMessage(replaced, message);
  return {
    files: sources.flatMap((s) => fileOf(s) ?? []),
    recorded: sources.flatMap((s) => recordingOf(s) ?? []),
    groups: [
      ...(auto.length ? [{ key: 'history', icon: 'history' as const, label: 'Saved conversations that match your message', entries: auto.map((a) => ({ text: a.title, pct: a.match })) }] : []),
      ...(autoBookmarks.length ? [{ key: 'bookmarks', icon: 'bookmark' as const, label: 'Bookmarks that match your message', entries: autoBookmarks.map((b) => ({ text: b.title, pct: b.match, url: b.url, bookmarkId: b.id })) }] : []),
      ...(memoryAuto.length ? [{ key: 'memory-auto', icon: 'memory' as const, label: 'Memory that matches your message', entries: memoryAuto.map((t) => ({ text: t })), open: openMemory }] : []),
      ...memory.map((m) => ({ key: `memory-${m.host}`, icon: 'memory' as const, label: `Memory for ${m.host}`, entries: m.items.map((t) => ({ text: t })), open: openMemory })),
      ...memoryIndexAttached(message).map((m) => ({ key: `memory-index-${m.host}`, icon: 'memory' as const, label: `Memory for ${m.host}, by title: the model reads one if it needs it`, entries: m.titles.map((t) => ({ text: t })), open: openMemory })),
      ...(siteSkills.length ? [{ key: 'skills', icon: 'skill' as const, label: 'Site skills: their rules for this site', entries: siteSkills.map((n) => ({ text: n })) }] : []),
      ...(masked ? [masked] : []),
    ],
  };
}

// Those as chips and small pills. With `onShow`, the pill opened is the caller's, which shows its list
// (AutoList) apart, under its own row; without it, the list opens under the pills.
export function AttachedChips({ message, className, shown, onShow }: { message: Message; className: string; shown?: string; onShow?: (key: string | undefined) => void }) {
  const { openMemory } = useContext(ChatActionsContext);
  const { files, recorded, groups } = messageAttached(message, openMemory, useContext(ReplacedContext));
  if (!files.length && !recorded.length && !groups.length) return null;
  return (
    <div className={className}>
      {files.map((name, i) => (
        <span key={`f${i}`} className="mention" title="A text file you attached, sent with this message (Layers shows it)">
          <Icon name="file" size={12} /> {name}
        </span>
      ))}
      {recorded.map((r, i) => (
        <span key={`r${i}`} className="mention" title="A recording of the page's requests, sent with this message (Layers shows it)">
          <Icon name="record" size={12} /> recording · {r.calls} {r.calls === 1 ? 'call' : 'calls'} · {r.site}
        </span>
      ))}
      <AutoAttached groups={groups} shown={shown} onShow={onShow} />
    </div>
  );
}

// What went after a tool's result on its own, between the model's steps; then what the word blacklist
// replaced in it.
export function stepGroups(result: ToolResultPart, openMemory?: () => void, replaced?: ReplacedView): AutoGroup[] {
  const { memory, bookmarks, plan } = stepAttached(result);
  const masked = replaced && replacedInResult(replaced, result);
  return [
    ...(memory.length ? [{ key: 'memory', icon: 'memory' as const, label: "Memory that matches the model's reply", entries: memory.map((t) => ({ text: t })), open: openMemory }] : []),
    ...(bookmarks.length ? [{ key: 'bookmarks', icon: 'bookmark' as const, label: "Bookmarks that match the model's reply", entries: bookmarks.map((b) => ({ text: b.title, pct: b.match, url: b.url, bookmarkId: b.id })) }] : []),
    ...(plan.length ? [{ key: 'plan', icon: 'plan' as const, label: 'Plan reminder', entries: plan.map((t) => ({ text: t })) }] : []),
    ...(masked ? [masked] : []),
  ];
}

// What went with your message on its own (auto-attach, memory, site skills): one quiet line, a small
// pill per kind with how many; its title lists them, and a click shows them, each with its match.
export interface AutoGroup {
  key: string;
  icon: ChatIconName;
  label: string;
  entries: { text: string; pct?: number; url?: string; bookmarkId?: string }[]; // url: a bookmark's, linked when http(s); bookmarkId: to look it up when the source has none
  open?: () => void; // where to see them all (the memory)
}
export function AutoAttached({ groups, shown: given, onShow }: { groups: AutoGroup[]; shown?: string; onShow?: (key: string | undefined) => void }) {
  const [own, setOwn] = useState<string>();
  if (!groups.length) return null;
  const shown = onShow ? given : own;
  const show = onShow ?? setOwn;
  const group = onShow ? undefined : groups.find((g) => g.key === shown);
  return (
    <span className="msg-auto">
      <span className="msg-auto-pills">
        {groups.map((g) => (
          <button key={g.key} type="button" className="msg-auto-pill" aria-expanded={shown === g.key}
            title={`${g.label}, sent with this message:\n${g.entries.map((e) => `• ${e.text}${e.pct !== undefined ? ` (${e.pct}%)` : ''}`).join('\n')}`}
            onClick={() => show(shown === g.key ? undefined : g.key)}>
            <Icon name={g.icon} size={11} /> {g.entries.length}
          </button>
        ))}
      </span>
      {group && <AutoList group={group} />}
    </span>
  );
}

// An open pill's list, on a line of its own.
export function AutoList({ group }: { group: AutoGroup }) {
  return (
    <span className="msg-auto-line">
      <span className="msg-auto-list" role="list" aria-label={group.label}>
        <span className="msg-auto-title">{group.label}</span>
        {group.entries.map((e, i) => (
          <span key={i} role="listitem" className="msg-auto-entry">
            <EntryText text={e.text} url={e.url} bookmarkId={e.bookmarkId} />
            {e.pct !== undefined && <span className="msg-auto-pct">{e.pct}%</span>}
          </span>
        ))}
        {group.open && <button type="button" className="link-button" onClick={group.open}>Open the memory</button>}
      </span>
    </span>
  );
}

// An entry's text: a link to its page in a new tab, with its host, when it has a web address (a
// bookmark's); any other address (javascript:, file:…) stays plain text. A bookmark attached before
// its source kept the address: looked up by its id (none once it is deleted).
function EntryText({ text, url, bookmarkId }: { text: string; url?: string; bookmarkId?: string }) {
  const [found, setFound] = useState<string>();
  useEffect(() => {
    if (url || !bookmarkId) return;
    let current = true;
    void bookmarkUrl(bookmarkId).then((u) => current && setFound(u));
    return () => {
      current = false;
    };
  }, [url, bookmarkId]);
  const web = webUrlOf(url ?? found);
  if (!web) return <span className="msg-auto-text" title={url}>{text}</span>;
  return (
    <>
      <a className="msg-auto-text" href={web.href} target="_blank" rel="noopener noreferrer" title={web.href}>{text}</a>
      <span className="msg-auto-host">{web.host}</span>
    </>
  );
}
