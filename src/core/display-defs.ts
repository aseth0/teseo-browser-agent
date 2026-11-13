// What the chat shows that the user can change (Settings → Display): one place for each element, its
// default (how the chat looked before it could be changed), the values it takes and what they mean.
// The settings keep only what was changed (`Settings.display`); a value this build does not have (saved
// by another build sharing the settings) reads as the default (storage/settings-select displayOf).
// A `locked` element is always shown, whatever is stored: it says something the user must see (that
// a text came from the web, that a call failed or was cut, that it ran through DevTools). The section
// lists those as "Always shown", with `why`.

// Where an element is, to group them in the section.
export type DisplaySurface = 'tool-call' | 'answer';

export const DISPLAY_SURFACES: Record<DisplaySurface, { label: string; about: string }> = {
  'tool-call': { label: 'Tool calls', about: 'Each call the model makes, in its steps' },
  answer: { label: 'Under the answer', about: 'The row of actions under the model’s answer' },
};

export interface DisplayDef {
  label: string; // what the element is
  about: string; // a line on it, under its name
  surface: DisplaySurface;
  default: string;
  allowed: Readonly<Record<string, string>>; // its values, by their label in the section, in order
  locked?: true; // always its default
  why?: string; // locked: why it cannot be hidden
}

const SHOWN_HIDDEN = { shown: 'Shown', hidden: 'Hidden' } as const;
const ALWAYS = { shown: 'Shown' } as const;

const DEFS = {
  toolArgs: {
    label: 'Arguments',
    about: 'As the JSON the model sent, or as fields: a name and its value each, as on a confirmation card',
    surface: 'tool-call',
    default: 'json',
    allowed: { json: 'JSON', fields: 'Fields' },
  },
  toolResultView: {
    label: 'Result shown first as',
    about: 'A result that holds JSON opens as text or as that JSON, indented and colored; its switch still changes it',
    surface: 'tool-call',
    default: 'text',
    allowed: { text: 'Text', json: 'JSON' },
  },
  toolScreenshot: {
    label: 'Screenshot thumbnail',
    about: 'A small image in the call’s row when it returned one; the result still shows it',
    surface: 'tool-call',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
  toolTab: {
    label: 'Tab chip',
    about: 'The title of the tab the call ran on, as it was then',
    surface: 'tool-call',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
  toolMemoryTitle: {
    label: 'Memory item title',
    about: 'On a call that reads or changes a memory item, that item’s title',
    surface: 'tool-call',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
  toolAttached: {
    label: 'Auto-attached pills',
    about: 'What went to the model on its own after the call (memory, bookmarks, history), as pills in its row',
    surface: 'tool-call',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
  subAgentTrace: {
    label: 'Sub-agent or script steps',
    about: 'What another agent or a script tool did inside the call: open while it works, then closed or left open',
    surface: 'tool-call',
    default: 'closed',
    allowed: { closed: 'Closed when done', open: 'Left open' },
  },
  untrustedMark: {
    label: '“from the web · untrusted” mark',
    about: 'On a result read from a page, a server or a site',
    surface: 'tool-call',
    default: 'shown',
    allowed: ALWAYS,
    locked: true,
    why: 'It tells you the text came from outside and may try to steer the model.',
  },
  toolErrors: {
    label: 'Errors',
    about: 'A call that failed, marked as such, with its error',
    surface: 'tool-call',
    default: 'shown',
    allowed: ALWAYS,
    locked: true,
    why: 'A failed call changes what the answer can be trusted for.',
  },
  cutMark: {
    label: 'Cut mark (✂)',
    about: 'A result cut to a size limit',
    surface: 'tool-call',
    default: 'shown',
    allowed: ALWAYS,
    locked: true,
    why: 'The model got only part of it.',
  },
  devtoolsBadge: {
    label: 'DevTools badge',
    about: 'A call that ran through Chromium DevTools',
    surface: 'tool-call',
    default: 'shown',
    allowed: ALWAYS,
    locked: true,
    why: 'It sent real input to the page, with more reach than the page script.',
  },
  answerAgent: {
    label: 'Agent',
    about: 'The agent that gave the answer (none for Default)',
    surface: 'answer',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
  answerStats: {
    label: 'Tokens and time',
    about: 'The turn’s tokens and response time, at the end of the row',
    surface: 'answer',
    default: 'shown',
    allowed: SHOWN_HIDDEN,
  },
} as const satisfies Record<string, DisplayDef>;

export type DisplayId = keyof typeof DEFS;
// The values an element takes: DisplayValue<'toolArgs'> is 'json' | 'fields'.
export type DisplayValue<K extends DisplayId> = keyof (typeof DEFS)[K]['allowed'] & string;
// Every element at the value it shows with.
export type DisplayValues = { [K in DisplayId]: DisplayValue<K> };

export const DISPLAY_DEFS: Record<DisplayId, DisplayDef> = DEFS;
export const DISPLAY_IDS = Object.keys(DEFS) as DisplayId[];

// The value an element shows with, from the one stored: the default when it is locked, unset, or a
// value this build does not have.
export function displayFrom<K extends DisplayId>(id: K, stored: unknown): DisplayValue<K> {
  const def = DISPLAY_DEFS[id];
  const ok = !def.locked && typeof stored === 'string' && Object.hasOwn(def.allowed, stored);
  return (ok ? stored : def.default) as DisplayValue<K>;
}

// Every element at its default.
export const DISPLAY_DEFAULTS = Object.fromEntries(DISPLAY_IDS.map((id) => [id, DISPLAY_DEFS[id].default])) as DisplayValues;
