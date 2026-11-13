// A text read aloud from the chat (an answer, the page's selection): a speaker that turns into Stop
// while that text is read (ChatActions.speak), and says what went wrong in its title and to screen readers.
import { useState } from 'react';
import { Icon } from '../chat-icons';
import type { SpeakButtons } from './contexts';

export function SpeakButton({ speak, speakKey, text, agentId, label, className = 'icon-button', size = 16 }: {
  speak: SpeakButtons;
  speakKey: string;
  text: string;
  agentId: string | undefined;
  label: string; // "Read the answer aloud"
  className?: string;
  size?: number;
}) {
  const [clicked, setClicked] = useState(false); // the last failure is this button's
  const on = speak.speaking(speakKey);
  const failed = on ? '' : clicked ? speak.failed : (speak.notRead?.(speakKey) ?? '');
  const name = on ? 'Stop reading aloud' : failed ? `${label} (${failed})` : label;
  return (
    <button type="button" className={`${className}${failed ? ' warn' : ''}`} title={name} aria-label={name} aria-pressed={on} disabled={!on && !text.trim()}
      onClick={() => {
        setClicked(true);
        speak.toggle(speakKey, text, agentId);
      }}>
      <Icon name={on ? 'stop' : 'audio'} size={size} />
    </button>
  );
}
