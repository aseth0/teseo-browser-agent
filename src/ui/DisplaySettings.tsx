// Settings → Display: what the chat shows of each element that can change, built from the registry
// (core/display-defs) and grouped by where it is, next to the side panel itself as a preview (as in
// Appearance). The locked ones are listed apart, "Always shown", with why.
import { browser } from 'wxt/browser';
import { DISPLAY_DEFS, DISPLAY_IDS, DISPLAY_SURFACES, type DisplayId, type DisplaySurface } from '../core/display-defs';
import { displayOf } from '../storage/settings-select';
import { Switch } from './Collection';
import { withKey } from './edits';
import { SectionHead, StatStrip } from './SectionParts';
import { Segmented } from './Segmented';
import type { PatchSectionProps as Props } from './useSettings';

const SURFACES = Object.keys(DISPLAY_SURFACES) as DisplaySurface[];
const isShownHidden = (id: DisplayId) => Object.keys(DISPLAY_DEFS[id].allowed).join() === 'shown,hidden';

export function DisplaySection({ settings, onChange }: Props) {
  // The default is not stored: back to it, the element is as if never changed.
  const set = (id: DisplayId, value: string) => onChange({ display: withKey(settings.display ?? {}, id, value === DISPLAY_DEFS[id].default ? undefined : value) });
  const changeable = DISPLAY_IDS.filter((id) => !DISPLAY_DEFS[id].locked);
  const locked = DISPLAY_IDS.filter((id) => DISPLAY_DEFS[id].locked);
  const changed = changeable.filter((id) => displayOf(settings, id) !== DISPLAY_DEFS[id].default);
  const hidden = changeable.filter((id) => displayOf(settings, id) === 'hidden');
  return (
    <section className="display-settings">
      <SectionHead title="Display" about={<>
        What the chat shows of each tool call and under each answer. It changes only what you see: the model gets the same.
        On the left, the side panel itself with an example conversation; the calls already in a chat change too.
        How the steps and tool calls fold, the theme and the fonts: <a href="#appearance">Appearance</a>.
      </>} />
      <StatStrip stats={[
        { label: 'Changed', value: <>{changed.length} <span className="stat-of">/ {changeable.length}</span></>, sub: changed.length ? changed.slice(0, 2).map((id) => DISPLAY_DEFS[id].label).join(', ') + (changed.length > 2 ? '…' : '') : 'All as by default' },
        { label: 'Hidden', value: hidden.length, sub: hidden.length ? hidden.slice(0, 2).map((id) => DISPLAY_DEFS[id].label).join(', ') + (hidden.length > 2 ? '…' : '') : 'Nothing hidden' },
        { label: 'Always shown', value: locked.length, sub: 'Cannot be hidden' },
      ]} />
      <div className="appearance-layout">
        <iframe className="panel-preview" src={browser.runtime.getURL('/sidepanel.html?preview')} title="Side panel preview" />
        <div className="appearance-options">
          {SURFACES.map((surface) => {
            const ids = changeable.filter((id) => DISPLAY_DEFS[id].surface === surface);
            if (!ids.length) return null;
            return (
              <div key={surface} className="display-group">
                <h4>{DISPLAY_SURFACES[surface].label}</h4>
                <p className="hint">{DISPLAY_SURFACES[surface].about}</p>
                <ul className="switch-rows" aria-label={DISPLAY_SURFACES[surface].label}>
                  {ids.map((id) => <DisplayRow key={id} id={id} value={displayOf(settings, id)} onSet={(v) => set(id, v)} />)}
                </ul>
              </div>
            );
          })}
          <div className="display-group display-locked">
            <h4>Always shown</h4>
            <p className="hint">These say something you must see, so they cannot be hidden.</p>
            <ul className="switch-rows" aria-label="Always shown">
              {locked.map((id) => (
                <li key={id}>
                  <div><strong>{DISPLAY_DEFS[id].label}</strong><span className="hint">{DISPLAY_DEFS[id].about}. {DISPLAY_DEFS[id].why}</span></div>
                  <span className="muted small">{DISPLAY_SURFACES[DISPLAY_DEFS[id].surface].label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// An element: its name and a line on it, and its control: a switch for shown or hidden, else its values.
function DisplayRow({ id, value, onSet }: { id: DisplayId; value: string; onSet: (value: string) => void }) {
  const def = DISPLAY_DEFS[id];
  return (
    <li>
      <div><strong>{def.label}</strong><span className="hint">{def.about}</span></div>
      {isShownHidden(id) ? (
        <Switch checked={value === 'shown'} label={def.label} onChange={(on) => onSet(on ? 'shown' : 'hidden')} />
      ) : (
        <Segmented label={def.label} className="compact" value={value} onChange={onSet}
          options={Object.entries(def.allowed).map(([v, label]) => ({ value: v, label }))} />
      )}
    </li>
  );
}
