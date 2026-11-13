// The head of a list over the chat (history, bookmarks, memory): its search, focused (Escape closes
// the list), the list's own buttons, then Close.
import type { ReactNode } from 'react';

export function PanelHead({ query, onQuery, placeholder, label, disabled, onClose, children }: {
  query: string;
  onQuery: (query: string) => void;
  placeholder: string;
  label: string; // of the search box
  disabled?: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="history-head">
      <input type="search" value={query} placeholder={placeholder} aria-label={label} autoFocus disabled={disabled}
        onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  );
}
