// Settings → Auto-inject: in one place, what goes with a message without being asked for (context/
// auto-inject) and what you can mention to attach; each switch is the same as on its own page, which
// has the details. The chat's ✨ menu leaves any of them out of one conversation.
import type { ReactNode } from 'react';
import { autoInjectGlobal, type AutoInjectKind } from '../context/auto-inject';
import { historyOn, includePageOn, memoryOn, mentionsOn, withAutoAttach, type MentionKind } from '../storage/settings-select';
import { Switch } from './Collection';
import { SectionHead, SectionTabs, StatStrip } from './SectionParts';
import { SectionTop } from './SectionTop';
import { GoTo } from './text-pages';
import type { PatchSectionProps as Props } from './useSettings';

// The kinds whose switch is their section's auto-attach (its own page has the same one).
const AUTO_ATTACH_SWITCH: Partial<Record<AutoInjectKind, ['memory' | 'bookmarks' | 'history', 'enabled' | 'steps']>> = {
  memoryAuto: ['memory', 'enabled'],
  memorySteps: ['memory', 'steps'],
  bookmarkAuto: ['bookmarks', 'enabled'],
  bookmarkSteps: ['bookmarks', 'steps'],
  historyAuto: ['history', 'enabled'],
};

// What can be mentioned in a message; what each sends is edited where it belongs.
const MENTION_KINDS: [MentionKind, ReactNode][] = [
  ['templates', <><code>::site/view</code> site templates (texts in Site templates)</>],
  ['skills', <><code>/skill</code> skills (text in Skills)</>],
  ['tools', <><code>$tool</code> tools (text and forcing in Tools)</>],
  ['history', <><code>#saved-conversation</code> saved conversations (History)</>],
  ['bookmarks', <><code>b::bookmark</code> bookmarks (Bookmarks)</>],
];

const STEPS_ABOUT = "Also what the model writes before calling a tool (not its reasoning): what matches goes after that tool's result.";

// A row: its name, a link to its own page, what it sends (or why it cannot be switched on), its switch.
interface Row {
  key: string;
  label: ReactNode;
  name?: string; // its switch's, when the label is not text
  about?: ReactNode;
  on: boolean;
  set: (on: boolean) => void;
  page?: [hash: string, title: string];
  blocked?: string; // and its switch disabled
  sub?: boolean; // how the row above it goes
}

function SwitchRows({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <ul className="switch-rows" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className={r.sub ? 'sub' : undefined}>
          <div>
            <strong>{r.label}</strong>{r.page && <> <GoTo hash={r.page[0]} title={r.page[1]} /></>}
            {(r.blocked || r.about) && <span className="hint">{r.blocked ? `${r.blocked}${r.sub ? ' (switch it on above).' : ' (switch it on in its page).'}` : r.about}</span>}
          </div>
          <Switch checked={r.on} disabled={!!r.blocked} label={r.name ?? String(r.label)} onChange={r.set} />
        </li>
      ))}
    </ul>
  );
}

function autoInjectRows({ settings, onChange }: Props) {
  const memoryOff = !memoryOn(settings) ? 'Memory is off' : undefined;
  const kind = (k: AutoInjectKind, row: Omit<Row, 'key' | 'on' | 'set'>): Row => ({
    key: k, on: autoInjectGlobal(settings, k), ...row,
    set: (on) => {
      const own = AUTO_ATTACH_SWITCH[k];
      onChange(own ? withAutoAttach(settings, own[0], { [own[1]]: on }) : { autoInject: { ...settings.autoInject, [k]: on } });
    },
  });
  const fromPage: Row[] = [
    {
      key: 'page', label: 'Page', page: ['limits', 'Limits'], on: includePageOn(settings), set: (on) => onChange({ includePage: on }),
      about: "The active page (its text, selection and visible elements) with each message: the same switch as the chat's page button.",
    },
    kind('memory', { label: 'Site memory', page: ['memory', 'Memory'], about: "The memory items linked to the page's site, each once in a conversation.", blocked: memoryOff }),
    kind('memorySiteMatch', {
      label: 'Only those that match', sub: true, blocked: !autoInjectGlobal(settings, 'memory') ? 'Site memory is off' : undefined,
      about: 'Whole only if pinned or if your message matches it (the match needed, in Memory → Matching); the others go as a line with their title, and the model reads them if it needs to. Off: all of them whole. An agent without memory__read always gets them whole.',
    }),
    kind('siteSkills', { label: 'Site skills', page: ['skills', 'Skills'], about: "The rules of the skills for the page's site, with the first message there (then a reminder)." }),
    kind('templates', { label: 'Site templates', page: ['site-templates', 'Site templates'], about: "What the templates for the page's site read from it, with each message." }),
  ];
  const byMatch: Row[] = [
    kind('memoryAuto', { label: 'Matching memory', page: ['memory', 'Memory'], about: 'The memory items your message matches well enough, neither pinned nor linked to a site.', blocked: memoryOff }),
    kind('memorySteps', { label: "Also between the model's steps", sub: true, about: STEPS_ABOUT, blocked: !autoInjectGlobal(settings, 'memoryAuto') ? 'Matching memory is off' : undefined }),
    kind('bookmarkAuto', { label: 'Bookmarks', page: ['bookmarks', 'Bookmarks'], about: 'The bookmarks your message matches well enough, once allowed there.' }),
    kind('bookmarkSteps', { label: "Also between the model's steps", sub: true, about: STEPS_ABOUT, blocked: !autoInjectGlobal(settings, 'bookmarkAuto') ? 'Bookmarks auto-attach is off' : undefined }),
    kind('historyAuto', { label: 'Saved conversations', page: ['history', 'History'], about: 'The saved conversations your message matches well enough.', blocked: !historyOn(settings) ? 'History is off' : undefined }),
  ];
  const mentions: Row[] = MENTION_KINDS.map(([k, label]) => ({
    key: k, label, name: `Mentions: ${k}`, on: mentionsOn(settings, k), set: (on) => onChange({ mentions: { ...settings.mentions, [k]: on } }),
  }));
  return { fromPage, byMatch, mentions };
}

const onOf = (rows: Row[]) => rows.filter((r) => !r.sub && r.on).length;
const mainOf = (rows: Row[]) => rows.filter((r) => !r.sub).length;

export function AutoInjectSection(props: Props) {
  const { fromPage, byMatch, mentions } = autoInjectRows(props);
  const steps = (['memorySteps', 'bookmarkSteps'] as const).filter((k) => autoInjectGlobal(props.settings, k)).map((k) => (k === 'memorySteps' ? 'memory' : 'bookmarks'));
  return (
    <section className="auto-inject-settings">
      <SectionHead title="Auto-inject" about={<>
        What goes with a message on its own, without you mentioning it. The chat's ✨ menu leaves any of them out of one
        conversation; under each message, a chip says what went (Layers shows it all).
      </>} />
      <StatStrip stats={[
        { label: 'From the page', value: <>{onOf(fromPage)} <span className="stat-of">/ {mainOf(fromPage)} on</span></>, sub: 'The page, and what its site has' },
        { label: 'By a match', value: <>{onOf(byMatch)} <span className="stat-of">/ {mainOf(byMatch)} on</span></>, sub: steps.length ? `Also between steps: ${steps.join(', ')}` : "Not between the model's steps" },
        { label: 'Mentions', value: <>{onOf(mentions)} <span className="stat-of">/ {mentions.length} on</span></>, sub: 'Attached when you write them' },
      ]} />
      <SectionTabs label="Auto-inject" tabs={[
        { id: 'page', label: 'From the page', render: () => <SwitchRows rows={fromPage} label="Sent from the page and its site" /> },
        {
          id: 'match', label: 'By a match', render: () => <>
            <p className="hint">The match needed and how many go, on each one's <strong>Matching</strong> tab.</p>
            <SwitchRows rows={byMatch} label="Attached when your message matches" />
          </>,
        },
        {
          id: 'mentions', label: 'Mentions', render: () => <>
            <p className="hint">What you can mention in a message to attach it.</p>
            <SwitchRows rows={mentions} label="Mentions" />
          </>,
        },
        { id: 'limits', label: 'Limits', render: () => <SectionTop page="auto-inject" /> },
      ]} />
    </section>
  );
}
