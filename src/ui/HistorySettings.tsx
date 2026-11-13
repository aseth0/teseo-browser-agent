// Settings → History: whether conversations are saved (the switch at the top), the saved ones, for how
// long they are kept, what opening the panel does, a backup of them all, auto-attach and a message
// tried against them.
import { useState } from 'react';
import { useLive } from './useLive';
import { AUTO_DEFAULTS, historyPicks } from '../history/auto';
import { AttachPlayground, AutoAttachCard, AutoAttachControls, PLAYGROUND_RESULTS } from './AutoAttachBlock';
import { FilterChips, MatchCards, SectionHead, SectionTabs, StatStrip, TryBelow } from './SectionParts';
import { EmptyCollection, FilterBox, useFilter } from './Collection';
import { useAttempt } from './useAttempt';
import { LucideIcon } from './LucideIcon';
import { Pin, Trash2 } from 'lucide';
import { retentionLimit } from '../storage/retention';
import { agentNames, applyRetention, retentionCount, deleteAllConversations, deleteConversations, exportAll, historyBytes, importAll, listConversations, setPinned, type ConversationMeta } from '../history/store';
import { rankSaved, wholeOf } from '../history/search';
import { snippetOf } from '../history/read';
import { Snippet } from './Snippet';
import { InlineConfirm } from './InlineConfirm';
import { useConversationsVersion } from './useConversations';
import { withAutoAttach } from '../storage/settings-select';
import type { AutoAttach, HistorySettings } from '../storage/settings-types';
import { downloadText } from './download';
import { ModelTextEditor } from './EditableText';
import { MentionsFold } from './MentionsFold';
import { PageModelTexts } from './PageModelTexts';
import type { SectionProps as Props } from './useSettings';
import { errorText } from '../core/errors';
import { isEnter } from './enter';
import { TitleLinks } from './TitleLinks';
import { historyOn } from '../storage/settings-select';
import { SectionTop } from './SectionTop';

const NO_CHANGES = () => () => undefined; // a change is a new version
const NOT_READ: [ConversationMeta[] | undefined, number | undefined] = [undefined, undefined];
const size = (bytes: number) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1000)} KB`);

export function HistorySection({ settings, onChange }: Props) {
  const history = settings.history ?? {};
  // On the settings as they are by then: the retention is set after an await.
  const set = (change: Partial<HistorySettings>) => onChange((s) => ({ ...s, history: { ...s.history, ...change } }));
  const [message, setMessage] = useState('');

  // Again on every change to the saved conversations.
  const version = useConversationsVersion();
  const [list, bytes] = useLive(() => Promise.all([listConversations(), historyBytes()]), NO_CHANGES, NOT_READ, '[history]', version);
  const count = list?.length ?? 0;

  const exportFile = async () => downloadText(`teseo-conversations-${new Date().toISOString().slice(0, 10)}.json`, await exportAll());
  const importFile = async (file: File) => {
    try {
      setMessage(`Imported ${await importAll(await file.text())} conversations.`);
    } catch (e) {
      setMessage(`Error: ${errorText(e)}`);
    }
  };
  const keepDays = retentionLimit(history.keepDays);
  const keepCount = retentionLimit(history.keepCount);
  const kept = [keepDays ? `${keepDays} days untouched` : '', keepCount ? `at most ${keepCount}` : ''].filter(Boolean).join(' · ');

  const saving = (
    <>
      <div className="settings-block history-saving">
        <label>When the side panel opens
          <select value={history.resume ?? 'never'} onChange={(e) => set({ resume: e.target.value as HistorySettings['resume'] })}>
            <option value="never">Always start a new conversation</option>
            <option value="recent">Go on with the last conversation, if touched in the last 30 minutes</option>
          </select>
        </label>
        <Retention history={history} set={set} />
      </div>
      <div className="row">
        <button onClick={() => void exportFile()} disabled={!count}>Export all (JSON)</button>
        <label className="button-like">
          Import…
          <input type="file" accept="application/json,.json" hidden onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = ''; // the same file can be chosen again
          }} />
        </label>
        <InlineConfirm question="Delete every saved conversation? This cannot be undone." action="Delete all" onConfirm={deleteAllConversations}>
          {(ask) => <button className="danger" disabled={!count} onClick={ask}>Delete all</button>}
        </InlineConfirm>
      </div>
      {message && <p className={message.startsWith('Error') ? 'error-text' : 'muted'}>{message}</p>}
    </>
  );
  return (
    <section className="history-settings">
      <SectionHead title="History" about="Your conversations, saved in this browser only after every turn, with the page content they carried (not screenshots). Open them from the clock button of the side panel."
        toggle={{ label: 'Save conversations', on: historyOn(settings), onChange: (enabled) => set({ enabled }) }} />
      <StatStrip stats={[
        { label: 'Conversations', value: list ? count.toLocaleString('en-US') : '–', sub: list ? `${list.filter((c) => c.pinned).length} pinned` : undefined },
        { label: 'Space used', value: bytes === undefined ? '–' : size(bytes) },
        { label: 'Kept', value: <span className="stat-text">{kept || 'Until you delete them'}</span>, sub: kept ? 'Pinned ones stay' : undefined },
      ]} />
      <SectionTabs label="History" tabs={[
        { id: 'list', label: 'Conversations', render: () => <ConversationList list={list} /> },
        { id: 'saving', label: 'Saving', render: () => saving },
        { id: 'matching', label: 'Matching', render: () => <><HistoryMatching settings={settings} onChange={onChange} /><TryBelow><HistoryTry settings={settings} /></TryBelow></> },
        { id: 'texts', label: 'Limits and texts', render: () => (
          <>
            <SectionTop page="history" />
            <MentionsFold syntax="#conversation">
              <p className="hint">
                Mention a saved conversation in a message with <code>#</code> and its title in lowercase with dashes (the suggestions list them) to attach it to that message (switch
                mentions off in Auto-inject → Mentions).
              </p>
              <ModelTextEditor id="history.mention_note" />
            </MentionsFold>
            <PageModelTexts page="history" skip={['history.mention_note']} />
          </>
        ) },
      ]} />
    </section>
  );
}

type ListFilter = 'pinned' | 'week';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const when = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

// Settings → History → Conversations: the saved ones, latest first, searched by title, with pin and
// delete (asked first). They open from the side panel's history.
function ConversationList({ list }: { list: ConversationMeta[] | undefined }) {
  const { filter, setFilter, matches } = useFilter();
  const [kind, setKind] = useState<ListFilter | 'all'>('all');
  const [now] = useState(() => Date.now());
  const { failed, attempt } = useAttempt();
  if (!list) return null;
  const isOf = (c: ConversationMeta, k: ListFilter) => (k === 'pinned' ? !!c.pinned : now - c.updatedAt < WEEK_MS);
  const searched = [...list].sort((a, b) => b.updatedAt - a.updatedAt).filter((c) => matches([c.title, agentNames(c), c.site]));
  const shown = kind === 'all' ? searched : searched.filter((c) => isOf(c, kind));
  return (
    <>
      <div className="row">
        <FilterBox label="Search conversations" value={filter} onChange={setFilter} />
      </div>
      <FilterChips label="Show the conversations" value={kind} onChange={setKind} total={searched.length}
        filters={[
          { id: 'pinned', label: '📌 Pinned', tone: 'always', count: searched.filter((c) => isOf(c, 'pinned')).length, title: 'Pinned ones stay, whatever is kept' },
          { id: 'week', label: 'This week', tone: 'site', count: searched.filter((c) => isOf(c, 'week')).length },
        ]} />
      <table className="collection-table conversation-table">
        <thead><tr><th>Conversation</th><th>Agents</th><th>Messages</th><th>Last</th><th /></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td><span className="item-name"><TitleLinks title={c.title} /></span>{c.site && <span className="muted small"> · {c.site}</span>}</td>
              <td className="muted">{agentNames(c) ?? '–'}</td>
              <td className="muted">{c.turns}</td>
              <td className="muted">{when(c.updatedAt)}</td>
              <td className="switch">
                <InlineConfirm label={`Confirm: delete ${c.title}`} onConfirm={() => attempt(deleteConversations([c.id]))}>
                  {(ask) => (
                    <span className="memory-actions">
                      <button className="icon-button" aria-pressed={!!c.pinned} aria-label={`${c.pinned ? 'Unpin' : 'Pin'} ${c.title}`} title={c.pinned ? 'Pinned: kept whatever is kept. Click to unpin' : 'Pin: kept whatever is kept'}
                        onClick={() => attempt(setPinned(c.id, !c.pinned))}><LucideIcon node={Pin} size={14} /></button>
                      <button className="icon-button warn" title="Delete" aria-label={`Delete ${c.title}`} onClick={ask}><LucideIcon node={Trash2} size={14} /></button>
                    </span>
                  )}
                </InlineConfirm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {failed && <p className="error-text" role="alert">{failed}</p>}
      <EmptyCollection shown={shown.length} total={list.length} one="conversation" many="saved conversations" loaded />
    </>
  );
}

// Settings → History → Matching: auto-attach on its card, with which conversations it looks among.
function HistoryMatching({ settings, onChange }: Props) {
  const auto = settings.history?.autoAttach ?? {};
  const setAuto = (change: Partial<AutoAttach>) => onChange(withAutoAttach(settings, 'history', change));
  return (
    <>
      <MatchCards>
        <AutoAttachCard auto={auto} defaults={AUTO_DEFAULTS} onChange={setAuto} label="Attach the saved conversations your message matches well enough on their own"
          about="Your message → the saved conversations">
          <ScopeField auto={auto} onChange={setAuto} />
        </AutoAttachCard>
      </MatchCards>
      <p className="hint">Each one cut to Settings → Limits. Under your message, a small clock pill says how many went (a click lists them).</p>
    </>
  );
}

// Settings → History → Matching, under the card (history/auto): a message tried against the saved conversations, with
// what would go with it.
function HistoryTry({ settings }: Pick<Props, 'settings'>) {
  const auto = settings.history?.autoAttach ?? {};
  const version = useConversationsVersion();
  const search = async (query: string) => {
    const { ranked: found, loaded } = await rankSaved(query);
    const ranked = found.map(({ meta, match }) => ({ conv: meta, match }));
    const shown = ranked.slice(0, PLAYGROUND_RESULTS);
    const whole = await wholeOf(shown.map((r) => r.conv.id), loaded); // for their snippets
    return {
      picked: historyPicks(ranked, query, [], auto).picks.map((p) => p.conv.id),
      hits: shown.map(({ conv, match }) => {
        const full = whole.get(conv.id);
        return {
          id: conv.id,
          match,
          never: (auto.scope ?? AUTO_DEFAULTS.scope) === 'pinned' && !conv.pinned ? 'not pinned (Among, above)' : undefined,
          title: <>{conv.pinned && '📌 '}<TitleLinks title={conv.title} /></>,
          detail: full && <Snippet text={snippetOf(full, query)} query={query} prefix={false} />,
        };
      }),
    };
  };
  return (
    <AttachPlayground auto={auto} defaults={AUTO_DEFAULTS} search={search} refresh={version}
      nouns={['conversation', 'conversations']} searchLabel="Try a search"
      hint="A message as you would send it: how well each saved conversation matches, against the card above, and which would go with it." />
  );
}

const ScopeField = ({ auto, onChange }: { auto: AutoAttach; onChange: (change: Partial<AutoAttach>) => void }) => (
  <label>Among
    <select value={auto.scope ?? AUTO_DEFAULTS.scope} onChange={(e) => onChange({ scope: e.target.value as 'pinned' | 'all' })}>
      <option value="pinned">Pinned conversations 📌</option>
      <option value="all">All saved conversations</option>
    </select>
  </label>
);

// The same settings in the side panel's history (🕘), without the playground.
export function AutoAttachFields({ settings, onChange }: Props) {
  const auto = settings.history?.autoAttach ?? {};
  const setAuto = (change: Partial<AutoAttach>) => onChange(withAutoAttach(settings, 'history', change));
  return (
    <>
      <AutoAttachControls auto={auto} defaults={AUTO_DEFAULTS} onChange={setAuto} label="Attach the saved conversations your message matches well enough on their own">
        <ScopeField auto={auto} onChange={setAuto} />
      </AutoAttachControls>
      <p className="hint">Under your message, a small clock pill says how many went (a click lists them). Try a message in Settings → History.</p>
    </>
  );
}

// How long conversations are kept. A number is saved once you leave its field (or press Enter), not
// as it is typed ("50" passes through "5"); when it would delete conversations, only once you say so:
// Undo leaves the setting as it was. Never saved unasked, as every saved conversation applies it.
type Kept = Pick<HistorySettings, 'keepDays' | 'keepCount'>;
function Retention({ history, set }: { history: HistorySettings; set: (change: Partial<HistorySettings>) => void }) {
  const [typed, setTyped] = useState<Kept>(); // what the fields show while not saved yet
  const [deleting, setDeleting] = useState<{ count: number; next: Kept }>();
  const { failed, attempt } = useAttempt();
  const number = (v: string) => (v ? Math.max(1, Math.round(Number(v))) : undefined);
  const shown: Kept = { keepDays: retentionLimit(history.keepDays), keepCount: retentionLimit(history.keepCount), ...typed };
  const commit = async () => {
    if (!typed || deleting) return;
    const next = { ...shown };
    if (next.keepDays === history.keepDays && next.keepCount === history.keepCount) return setTyped(undefined);
    const count = await retentionCount({ ...history, ...next });
    if (count) return setDeleting({ count, next });
    set(next);
    setTyped(undefined);
  };
  const done = () => {
    setTyped(undefined);
    setDeleting(undefined);
  };
  const field = (key: keyof Kept, placeholder: string) => (
    // Fixed while it asks: "Delete them" applies what it asked about.
    <input className="narrow-input" type="number" min={1} placeholder={placeholder} value={shown[key] ?? ''} disabled={!!deleting}
      onBlur={() => attempt(commit())} onKeyDown={(e) => isEnter(e) && e.currentTarget.blur()}
      onChange={(e) => setTyped({ ...typed, [key]: number(e.target.value) })} />
  );
  return (
    <>
      <div className="row">
        <label>Delete after (days untouched){field('keepDays', 'never')}</label>
        <label>Keep at most (conversations){field('keepCount', 'all')}</label>
      </div>
      {deleting && (
        <span className="inline-confirm" role="group" aria-label="Delete conversations">
          This deletes {deleting.count} saved {deleting.count === 1 ? 'conversation' : 'conversations'} now (pinned ones are kept).
          <button className="danger" autoFocus onClick={() => {
            set(deleting.next);
            attempt(applyRetention({ ...history, ...deleting.next }));
            done();
          }}>Delete them</button>
          <button onClick={done}>Undo</button>
        </span>
      )}
      {failed && <p className="error-text" role="alert">{failed}</p>}
    </>
  );
}
