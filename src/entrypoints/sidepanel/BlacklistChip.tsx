// The page bar's chip for the word blacklist (word-blacklist/gate chatBlacklistState): on in this
// conversation, a click turns it off (asked first once something went masked: the model would get the
// whole conversation as it is); off, a click turns it on. None while it is off in Settings or has no terms.
import { useEffect, useState } from 'react';
import { Icon } from '../../ui/chat-icons';
import { InlineConfirm } from '../../ui/InlineConfirm';
import { compileBlacklist, type Blacklist, type BlacklistConfig } from '../../word-blacklist/core';
import { loadBlacklistConfig, loadBlacklistEntries, onBlacklistChanged } from '../../word-blacklist/store';

interface WordBlacklistNow {
  config: BlacklistConfig;
  blacklist?: Blacklist; // none without a term to replace
}

// Settings → Word blacklist as saved now.
export function useWordBlacklist(): WordBlacklistNow {
  const [state, setState] = useState<WordBlacklistNow>({ config: {} });
  useEffect(() => {
    let live = true;
    const read = async () => {
      const [config, entries] = await Promise.all([loadBlacklistConfig(), loadBlacklistEntries()]);
      const blacklist = compileBlacklist(entries);
      if (live) setState({ config, ...(!blacklist.empty && { blacklist }) });
    };
    const report = (e: unknown) => console.error('[word blacklist]', e);
    void read().catch(report);
    const off = onBlacklistChanged(() => void read().catch(report));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

// `sentMasked`: something of the conversation went masked already.
export function BlacklistChip({ state, sentMasked, onChoose }: { state: 'off' | 'available' | 'active'; sentMasked: boolean; onChoose: (choice: 'on' | 'off') => void }) {
  if (state === 'off') return null;
  if (state === 'available')
    return (
      <button className="icon-button chip-button muted" title="Turn on the word blacklist for this chat" onClick={() => onChoose('on')}>
        <Icon name="blacklist" size={12} /> Word blacklist: off
      </button>
    );
  const chip = (onClick: () => void) => (
    <button className="icon-button chip-button" title="Sensitive terms are replaced with placeholders before they reach the model in this chat. Click to turn it off." onClick={onClick}>
      <Icon name="blacklist" size={12} /> Word blacklist
    </button>
  );
  if (!sentMasked) return chip(() => onChoose('off'));
  return (
    <InlineConfirm question="Turn off the word blacklist for this chat? The model will get the whole conversation with the real terms." action="Turn off" onConfirm={() => onChoose('off')}>
      {chip}
    </InlineConfirm>
  );
}
