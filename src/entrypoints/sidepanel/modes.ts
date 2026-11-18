// What the chat's top bar shows in each place it runs: the side panel, floating on a page (the
// widget's bar says what it is), or in the agent manager's page, where nothing may reach another chat
// (the pin and the move hand conversations over; history and watches open saved ones, which another
// row may hold) and the page lists the agents itself; or full-screen in a tab, which keeps history and
// watches but no move (it would close the tab) and no lead (the browser's tab has the title). Floating,
// the move back to the side panel is on the widget's bar (widget/ui/floating-chat). Dictation
// everywhere but the preview (floating, it records in the offscreen document: sidepanel/useDictation).
export interface ChatChrome {
  lead: boolean; // the pin's slot and the title
  watches: boolean;
  move: boolean;
  history: boolean;
  agents: boolean; // opens the agent manager, and the chat in a tab
  voice: boolean; // the message box's 🎤
}

export function chatChrome(mode: { floating: boolean; manager: boolean; full: boolean; preview: boolean }): ChatChrome {
  const panel = !mode.floating && !mode.manager && !mode.full;
  return { lead: panel, watches: !mode.manager, move: panel, history: !mode.manager, agents: panel && !mode.preview, voice: !mode.preview };
}
