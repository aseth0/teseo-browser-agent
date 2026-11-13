// The message box's 🎤 (useDictation) and what it says under the box: why it stopped, no model
// chosen, and the card for a microphone the side panel cannot ask for (it opens mic.html in a tab).
import { browser } from 'wxt/browser';
import { Icon } from '../../ui/chat-icons';
import type { Dictation } from './useDictation';

export function DictateButton({ dictation }: { dictation: Dictation }) {
  const { state } = dictation;
  const label = state === 'finishing' ? 'Finishing dictation…' : state === 'idle' ? 'Dictate' : 'Stop dictating';
  return (
    <button className={`icon-button dictate ${state}`} onClick={dictation.toggle} disabled={state === 'finishing'} title={label} aria-label={label}>
      <Icon name="mic" size={16} />
    </button>
  );
}

const openMicPage = () => void browser.tabs.create({ url: browser.runtime.getURL('/mic.html') });

export function DictationLines({ dictation }: { dictation: Dictation }) {
  const { problem, note } = dictation;
  return (
    <>
      {problem && (
        <div className="msg notice dictation-line" role="alert">
          {problem === 'blocked' ? (
            <>
              The side panel can't ask for the microphone. Allow it once in a tab, then click 🎤 again.
              <button onClick={openMicPage}>Allow microphone</button>
            </>
          ) : 'No microphone found.'}
        </div>
      )}
      {note && <div className="msg notice dictation-line" role="status">{note}</div>}
    </>
  );
}
