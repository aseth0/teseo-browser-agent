// What the user did while a tabs-and-mouse recording ran (content/steps): a click, what was typed into a
// field (never the text of a password, card, code or secret-named field), a move to another tab.
export interface RecordedStep {
  at: number;
  tabId: number;
  kind: 'click' | 'type' | 'tab';
  target?: string; // the element's description (button "Pay"), or the tab's title and site
  text?: string; // what was typed; none where it is not kept
}
