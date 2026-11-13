import { useCallback, useState } from 'react';
import { errorText } from '../core/errors';

// A click's work (in a list over the chat, a switch in Settings): what the last one could not do
// (`failed`, cleared once one works), and `then` run either way, so a row never stays stuck renaming
// or asking to confirm.
export function useAttempt() {
  const [failed, setFailed] = useState('');
  const attempt = useCallback((work: Promise<unknown>, then?: () => void) => {
    void work.then(() => setFailed(''), (e: unknown) => setFailed(errorText(e))).finally(then);
  }, []);
  return { failed, setFailed, attempt };
}
