import type { ReactNode } from 'react';
import type { ChatRender } from '../../storage/settings-types';
import { DIAGRAM_ICON, JIRA_ICON, MARKDOWN_ICON, TECH_ICON, TEXT_ICON } from '../../ui/icons';
import { Popover } from '../../ui/Popover';

// How the chat is shown: one button that opens the choice.
const RENDER_MODES: { value: ChatRender; label: string; icon: ReactNode }[] = [
  { value: 'markdown', label: 'Markdown', icon: MARKDOWN_ICON },
  { value: 'plain', label: 'Plain text', icon: TEXT_ICON },
  { value: 'jira', label: 'Jira markup', icon: JIRA_ICON }, // to paste in an issue or a comment
  { value: 'tech', label: 'Layers', icon: TECH_ICON }, // with the requests sent to the model
  { value: 'diagrams', label: 'Diagrams', icon: DIAGRAM_ICON }, // each turn's steps drawn above its answer
];

// The view saved, as this build shows it: one it does not have (saved by another build of the
// extension, which shares its settings) shows as Markdown.
export const renderOf = (saved: string | undefined): ChatRender => RENDER_MODES.find((m) => m.value === saved)?.value ?? 'markdown';

export function RenderSelector({ render, onSelect }: { render: ChatRender; onSelect: (render: ChatRender) => void }) {
  const current = RENDER_MODES.find((m) => m.value === render)!;
  return (
    <Popover title={`Show the chat as: ${current.label}`} label={current.icon}>
      {(close) => (
        <div className="menu" role="menu" aria-label="Show the chat as">
          {RENDER_MODES.map((m) => (
            <button key={m.value} role="menuitemradio" aria-checked={m.value === render} className="menu-option"
              onClick={() => { onSelect(m.value); close(); }}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
