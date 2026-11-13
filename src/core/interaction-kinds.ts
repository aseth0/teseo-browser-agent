// What the agent waits for the user on, and how each alerts while the chat is not in view (Settings →
// Alerts, background/alerts): `silent` nothing, `badge` a "!" on the toolbar icon, `notify` that and a
// system notification. Never a sound. The defaults go by urgency: what stops a run until it is
// answered notifies; what only waits to be looked at (a sub-agent out of steps, the step limit, a
// recording to review) marks the badge.

export type AlertLevel = 'silent' | 'badge' | 'notify';
export const ALERT_LEVELS: readonly AlertLevel[] = ['silent', 'badge', 'notify'];

export interface InteractionDef {
  label: string; // Settings → Alerts
  hint: string; // what it is, under its label
  title: string; // the notification's title
  level: AlertLevel; // the default
}

export const INTERACTION_DEFS = {
  action: { label: 'Action to confirm', hint: 'A write action waits for Allow or Deny', title: 'An action waits for your confirmation', level: 'notify' },
  access: { label: 'Site access', hint: 'A tool needs a permission only you can grant', title: 'The agent asks for access', level: 'notify' },
  ask: { label: 'Question', hint: 'The model asks you something (user.ask)', title: 'The agent asks you', level: 'notify' },
  'sign-in': { label: 'Sign-in', hint: 'A page the agent reads wants you to sign in', title: 'The agent waits for you to sign in', level: 'notify' },
  pick: { label: 'Pick an element', hint: 'The agent waits for you to pick on the page', title: 'Pick an element on the page', level: 'notify' },
  'out-of-steps': { label: 'Sub-agent out of steps', hint: 'Go on with as many steps again?', title: 'A sub-agent ran out of steps', level: 'badge' },
  'step-limit': { label: 'Step limit', hint: 'The run stopped at its step limit: Continue?', title: 'The agent reached its step limit', level: 'badge' },
  recording: { label: 'Recording to review', hint: 'A recording stopped by itself and waits for review', title: 'A recording waits for review', level: 'badge' },
  'agent-waiting': { label: 'Agents Panel agent waiting', hint: 'An agent in the Agents Panel waits for you', title: 'An agent in the Agents Panel waits for you', level: 'notify' },
} as const satisfies Record<string, InteractionDef>;

export type InteractionKind = keyof typeof INTERACTION_DEFS;
export const INTERACTION_KINDS = Object.keys(INTERACTION_DEFS) as InteractionKind[];
export type InteractionLevels = Partial<Record<InteractionKind, AlertLevel>>;

export const isAlertLevel = (v: unknown): v is AlertLevel => ALERT_LEVELS.includes(v as AlertLevel);

// The level a kind alerts at: the user's, else its default (an unknown stored value reads as the default).
export const levelOf = (levels: InteractionLevels | undefined, kind: InteractionKind): AlertLevel => {
  const v = levels?.[kind];
  return isAlertLevel(v) ? v : INTERACTION_DEFS[kind].level;
};

// What an alert does: nothing while the chat is in view, else what its level says.
export const alertOf = (level: AlertLevel, inView: boolean): { badge: boolean; notify: boolean } =>
  inView ? { badge: false, notify: false } : { badge: level !== 'silent', notify: level === 'notify' };
