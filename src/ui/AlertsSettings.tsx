// Settings → Alerts: how each interaction that waits for you alerts while the chat is not in view
// (core/interaction-kinds, background/alerts): silent, the "!" on the toolbar icon, or that and a
// system notification. A level only changes how you are told: the cards ask as they always do.
import { ALERT_LEVELS, INTERACTION_DEFS, INTERACTION_KINDS, type AlertLevel, type InteractionKind } from '../core/interaction-kinds';
import { alertLevel } from '../storage/settings-select';
import { SectionHead } from './SectionParts';
import { Segmented } from './Segmented';
import type { PatchSectionProps as Props } from './useSettings';

const LEVELS: Record<AlertLevel, { label: string; title: string }> = {
  silent: { label: 'Silent', title: 'Nothing: the chat shows it when you open it' },
  badge: { label: 'Badge', title: '"!" on the toolbar icon until it is answered' },
  notify: { label: 'Notify', title: 'The badge, and a system notification: click it to show the chat' },
};

export function AlertsSection({ settings, onChange }: Props) {
  // The default kept as none, so a later change of defaults reaches those not changed.
  const set = (kind: InteractionKind, level: AlertLevel) => {
    const { [kind]: _old, ...rest } = settings.interactions ?? {};
    const next = level === INTERACTION_DEFS[kind].level ? rest : { ...rest, [kind]: level };
    onChange({ interactions: Object.keys(next).length ? next : undefined });
  };
  return (
    <section className="alerts-settings">
      <SectionHead title="Alerts" about={<>
        When the agent waits for you, it alerts only while the chat is not in view: the side panel closed, its tab or window in the background, the
        floating chat folded. Never with a sound. Answering clears it.
      </>} />
      <ul className="switch-rows" aria-label="Alerts">
        {INTERACTION_KINDS.map((kind) => (
          <li key={kind}>
            <div><strong>{INTERACTION_DEFS[kind].label}</strong><span className="hint">{INTERACTION_DEFS[kind].hint}</span></div>
            <Segmented label={INTERACTION_DEFS[kind].label} className="compact" value={alertLevel(settings, kind)} onChange={(level) => set(kind, level)}
              options={ALERT_LEVELS.map((value) => ({ value, ...LEVELS[value] }))} />
          </li>
        ))}
      </ul>
    </section>
  );
}
