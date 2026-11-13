// How a text is shown: Markdown rendered, or as written (`marks`: its tags and placeholders too).
import { IconButton, MARKDOWN_ICON, TEXT_ICON } from './icons';

export function MarkdownToggle({ on, onChange, marks }: { on: boolean; onChange: (on: boolean) => void; marks?: boolean }) {
  return (
    <>
      <IconButton label="Render Markdown" pressed={on} onClick={() => onChange(true)} icon={MARKDOWN_ICON} />
      <IconButton label={marks ? 'Show as written (tags and placeholders)' : 'Show as written'} pressed={!on} onClick={() => onChange(false)} icon={TEXT_ICON} />
    </>
  );
}
