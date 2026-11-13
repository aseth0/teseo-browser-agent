// A mark on the settings whose text reaches the model ("model", with when on hover), so it is clear
// what the model reads while editing. Not shown inside the prompt preview, where everything does.
import { createContext, useContext, type ReactNode } from 'react';
import type { LimitId } from '../core/limits';
import { TO_MODEL_ICON } from './icons';
import { LimitMark } from './LimitMark';

const Shown = createContext(true);
export const HideToModelMarks = ({ children }: { children: ReactNode }) => <Shown.Provider value={false}>{children}</Shown.Provider>;

export function ToModel({ when }: { when: string }) {
  if (!useContext(Shown)) return null;
  // A visual aid (the tooltip says when): kept out of the field's accessible name.
  return (
    <span className="to-model" title={`Sent to the model: ${when}`} aria-hidden="true">
      {TO_MODEL_ICON} model
    </span>
  );
}

// When an editable model text is sent, from its "Only when …" condition (null: a tool description).
export const textSentWhen = (when: string | null | undefined) =>
  when === null ? 'in the tool definitions of every request' : when ? `only when ${when}` : 'always, wherever this part applies';

// A field's label text with the mark (and those of the size limits on what it sends), kept on one line.
export const ModelLabel = ({ text, when, limits = [] }: { text: ReactNode; when: string; limits?: LimitId[] }) => (
  <span className="field-label">
    {text}
    <ToModel when={when} />
    {limits.map((id) => <LimitMark key={id} id={id} />)}
  </span>
);
