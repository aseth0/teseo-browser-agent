// The chat bar's menu of what goes with a message on its own (context/auto-inject), by group: the memory
// of the page's site, the memory it matches (between the model's steps too, and by meaning); its site
// skills and templates; the saved conversations and bookmarks it matches; and the page. Each can be left out of this conversation;
// what Settings → Auto-inject switched off shows off here, and the page is the same switch as the page
// button (every conversation).
import { Fragment } from 'react';
import { autoInjectGlobal, autoInjectOn, STEPS_OF, type AutoInjectKind } from '../../context/auto-inject';
import { siteSkillsFor } from '../../skills/prompt';
import { templatesFor } from '../../templates/render';
import { Icon } from '../../ui/chat-icons';
import { openOptions } from '../../ui/open-options';
import { useTemplates } from '../../ui/templates/useTemplates';
import { Popover } from '../../ui/Popover';
import { useSkills } from '../../ui/Skills';
import { useSettingsContext } from '../../ui/settings-context';
import { includePageOn } from '../../storage/settings-select';

interface Props {
  url?: string;
  skip: AutoInjectKind[];
  onSkip: (skip: AutoInjectKind[]) => void;
}

interface Row {
  kind: AutoInjectKind;
  label: string;
  detail: string;
  offTitle?: string; // where it is switched off in Settings, if not Auto-inject
}

export function AutoInjectMenu({ url, skip, onSkip }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const skills = siteSkillsFor(useSkills(), url).map((s) => s.name);
  const templates = templatesFor(useTemplates(), url).map((t) => t.name);
  const includePage = includePageOn(settings);
  const groups: { name: string; rows: Row[] }[] = [
    {
      name: 'Memory',
      rows: [
        { kind: 'memory', label: 'Site memory', detail: "the memory items of this page's site" },
        { kind: 'memoryAuto', label: 'Matching memory', detail: 'the items your message matches (Memory → Auto-attach)' },
        { kind: 'memorySteps', label: "Also between the model's steps", detail: 'those its replies match, after a tool' },
        // How both of those match: no sub-row of the one above. Off in Settings → Memory, not Auto-inject.
        { kind: 'memoryMeaning', label: 'Match by meaning', detail: 'your message also goes to the embeddings provider', offTitle: 'Off in Settings → Memory' },
      ],
    },
    {
      name: 'Site',
      rows: [
        { kind: 'siteSkills', label: 'Site skills', detail: skills.length ? skills.join(', ') : 'none for this page' },
        { kind: 'templates', label: 'Site templates', detail: templates.length ? templates.join(', ') : 'none for this page' },
      ],
    },
    {
      name: 'Saved',
      rows: [
        { kind: 'historyAuto', label: 'Saved conversations', detail: 'those your message matches (History → Auto-attach)' },
        { kind: 'bookmarkAuto', label: 'Bookmarks', detail: 'those your message matches (Bookmarks → Auto-attach)' },
        { kind: 'bookmarkSteps', label: "Also between the model's steps", detail: 'those its replies match, after a tool' },
      ],
    },
  ];
  const rows = groups.flatMap((g) => g.rows);
  // Left out of this conversation (the page has its own button): the icon dimmed, no number (a number
  // on it read as found), and the tooltip names them.
  const left = rows.filter((r) => autoInjectGlobal(settings, r.kind) && skip.includes(r.kind)).map((r) => (STEPS_OF[r.kind] ? `${rows.find((p) => p.kind === STEPS_OF[r.kind])!.label} between steps` : r.label));
  const toggle = (kind: AutoInjectKind, on: boolean) => onSkip(on ? skip.filter((k) => k !== kind) : [...skip, kind]);
  return (
    <Popover title={left.length ? `Sent on its own · left out here: ${left.join(', ')}` : 'Sent on its own with each message'}
      label={<span className={`auto-inject-button${left.length ? ' some-off' : ''}`}><Icon name="autoInject" size={16} /></span>}>
      {() => (
        <div className="menu auto-inject-menu" role="menu" aria-label="Sent on its own">
          <div className="menu-heading">In this conversation</div>
          {groups.map((g) => (
            <Fragment key={g.name}>
              <div className="menu-heading menu-subheading">{g.name}</div>
              {g.rows.map((r) => {
                const global = autoInjectGlobal(settings, r.kind);
                // Between steps: under its auto-attach, and only while that one goes here.
                const parent = STEPS_OF[r.kind];
                if (parent && !autoInjectGlobal(settings, parent)) return null;
                const usable = global && (!parent || autoInjectOn(settings, parent, skip));
                return (
                  <label key={r.kind} className={`menu-check${parent ? ' sub' : ''}`} role="menuitemcheckbox" aria-checked={usable && !skip.includes(r.kind)}
                    title={global ? r.detail : (r.offTitle ?? 'Off in Settings → Auto-inject')}>
                    <input type="checkbox" disabled={!usable} checked={usable && !skip.includes(r.kind)} onChange={(e) => toggle(r.kind, e.target.checked)} />
                    <span>{r.label}<span className="muted"> · {global ? r.detail : 'off in Settings'}</span></span>
                  </label>
                );
              })}
            </Fragment>
          ))}
          <div className="menu-heading">Every conversation</div>
          <label className="menu-check" role="menuitemcheckbox" aria-checked={includePage} title="The same switch as the page button">
            <input type="checkbox" checked={includePage} onChange={(e) => onChange({ includePage: e.target.checked })} />
            <span>Page<span className="muted"> · the active page with each message</span></span>
          </label>
          <button className="menu-option" role="menuitem" onClick={() => void openOptions('auto-inject')}>Settings → Auto-inject…</button>
        </div>
      )}
    </Popover>
  );
}
