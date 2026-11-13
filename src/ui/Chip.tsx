// Something that goes with the next message, shown small: its icon and text, and × to take it out
// (`remove`: what the button says it does). Without `remove`, a tag.
import type { ReactNode } from 'react';
import { Icon, type ChatIconName } from './chat-icons';

export function Chip({ className = 'mention', icon, title, remove, children }: {
  className?: string;
  icon?: ChatIconName;
  title?: string;
  remove?: { label: string; title?: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <span className={className} title={title}>
      {icon && <><Icon name={icon} size={12} /> </>}{children}
      {remove && <button className="icon-button" aria-label={remove.label} title={remove.title} onClick={remove.onClick}><Icon name="close" size={12} /></button>}
    </span>
  );
}
