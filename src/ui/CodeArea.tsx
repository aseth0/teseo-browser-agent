// A text box for code with its syntax colors: the text, colored (Code), under a textarea whose own
// text is transparent (only its caret and selection show), both scrolled together.
import { useRef } from 'react';
import { Code } from './CodeView';

export function CodeArea({ value, onChange, lang, rows = 12, label, placeholder, disabled }: { value: string; onChange: (value: string) => void; lang: string; rows?: number; label: string; placeholder?: string; disabled?: boolean }) {
  const colored = useRef<HTMLPreElement>(null);
  return (
    <div className="code-area" style={{ '--rows': rows } as React.CSSProperties}>
      {/* A last newline, so that an empty last line has its height as in the textarea. */}
      <pre ref={colored} aria-hidden="true"><Code source={`${value}\n`} lang={lang} /></pre>
      <textarea aria-label={label} placeholder={placeholder} disabled={disabled} spellCheck={false} autoCapitalize="off" autoComplete="off" value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => colored.current && Object.assign(colored.current, { scrollTop: e.currentTarget.scrollTop, scrollLeft: e.currentTarget.scrollLeft })} />
    </div>
  );
}
