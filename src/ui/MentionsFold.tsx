// A settings page's mentions (what you type in a message to attach something to it), folded at the
// top of the page: the syntax by its title, then what it does and the texts the model gets for it.
// Tinted in what you write's color (--c-you), told apart from the texts sent to the model.
import type { ReactNode } from 'react';
import { AtSign } from 'lucide';
import { LucideIcon } from './LucideIcon';

export function MentionsFold({ syntax, children }: { syntax: string; children: ReactNode }) {
  return (
    <details className="settings-fold mentions-fold">
      <summary><LucideIcon node={AtSign} size={14} /> Mentions <code>{syntax}</code></summary>
      {children}
    </details>
  );
}
