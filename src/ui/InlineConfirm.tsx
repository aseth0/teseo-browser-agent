// Asked first, inside the page (a side panel shows no confirm()): what cannot be undone, deleting
// above all. The button (`children`, given `ask`) turns into the question, its confirming button
// focused; Escape or Cancel goes back to it. Either way the focus goes back to that button.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function InlineConfirm(props: {
  question?: string; // "Delete?"
  action?: string; // the confirming button: "Delete"
  label?: string; // what it says to a screen reader, e.g. "Confirm: delete notes"
  onConfirm: () => unknown;
  children: (ask: () => void) => ReactNode;
}) {
  const { question = 'Delete?', action = 'Delete', label, onConfirm, children } = props;
  const [asking, setAsking] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const asker = useRef<HTMLSpanElement>(null);
  const back = useRef(false); // the focus was in the question: it goes back to the button
  const done = () => {
    back.current = !!box.current?.contains(document.activeElement);
    setAsking(false);
  };
  useLayoutEffect(() => {
    if (asking || !back.current) return;
    back.current = false;
    asker.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus();
  }, [asking]);

  // In a box of its own, to find the button again; `display: contents` leaves the layout as it was.
  if (!asking) return <span ref={asker} style={{ display: 'contents' }}>{children(() => setAsking(true))}</span>;
  return (
    <span className="inline-confirm" role="group" aria-label={question} ref={box}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // not the dialog or panel around it
        done();
      }}>
      {question}
      <button className="danger" aria-label={label} autoFocus
        onClick={() => {
          done();
          void onConfirm();
        }}>{action}</button>
      <button onClick={done}>Cancel</button>
    </span>
  );
}
