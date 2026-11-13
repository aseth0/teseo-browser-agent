import { useState } from 'react';
import { agentAllows, type AgentProfile } from '../../agents/profiles';
import { hostOf } from '../../core/util';
import type { Settings } from '../../storage/settings';
import { includePageOn } from '../../storage/settings-select';
import { useSelection } from './SelectionChip';
import type { PageTarget } from './usePageTarget';

// Whether the page goes with the next message (sidepanel/Chat), and the text selected on it. `refresh`:
// read again when it changes (the history's length).
export function usePageSelection(settings: Settings, page: PageTarget, profile: AgentProfile | undefined, refresh: unknown) {
  const includePage = includePageOn(settings);
  // The selected text goes with the page block, when the page goes (an agent that uses only its
  // sites gets it only there); its chip leaves it out of the next message, or puts it back.
  const pageGoes = includePage && page.access === 'ok' && (!profile || agentAllows(profile, hostOf(page.url)));
  // Why the site templates read here are not sent: the page off, or an agent without the site.
  const pageWithheld = !includePage ? '"Page" is off' : profile && !pageGoes ? `${profile.name} was not given this site (the selector beside it)` : undefined;
  const selection = useSelection(page, pageGoes, refresh);
  const [skippedSelection, setSkippedSelection] = useState<string>();
  const noSelection = !!selection && skippedSelection === selection.text;
  return { includePage, pageWithheld, selection, noSelection, setSkippedSelection };
}
