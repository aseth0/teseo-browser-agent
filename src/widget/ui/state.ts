// What the page widget's parts share: its place on the site, the actions of the page, its elements
// (built with the widget, then always there while it shows) and the settings it follows.
import type { Appearance, ChatWindow } from '../../storage/settings-types';
import type { BubbleFace } from '../bubble-face';
import type { WidgetActionInfo, WidgetOutputs, WidgetPlace } from '../protocol';

export interface WidgetState {
  readonly site: string;
  place: WidgetPlace;
  actions: WidgetActionInfo[];
  host?: HTMLElement;
  bubble: HTMLElement;
  menu: HTMLElement;
  pop: HTMLElement;
  popBody: HTMLElement;
  count: HTMLElement; // on the bubble: how many actions found something on load
  waitMark: HTMLElement; // on the bubble: the floating chat waits for the user
  face: HTMLElement; // the bubble's look (Settings → Bubble): its icon, its shape and face, or the user's SVG
  drawn?: BubbleFace; // what the face shows
  at: { x: number; y: number }; // the bubble's place in the window, px
  hovering: boolean;
  moving: boolean; // the bubble is being dragged: its actions stay folded
  capturing?: boolean; // off the page while it is captured (WIDGET_HIDE): not kept for the site
  selection: string; // the page's selection when the pointer came in (a click inside may clear it)
  running?: AbortController; // the action whose card is open, while it runs
  appearance?: Appearance; // Settings → Appearance: light or dark and the accent
  chatWindow?: ChatWindow; // Settings → Bubble: where the chat opens
  noFloating?: boolean; // the chat cannot float here (Firefox: core/build floatingChat): it opens full screen in a tab
  speakButton?: boolean; // Settings → Speak: the button beside a selection (widget/ui/speak-selection)
  speakBoxes?: 'on' | 'setup'; // and the button on an action's text boxes (widget/ui/box-speak); 'setup': nothing to read with yet
  canSpeak?: boolean; // Speak on with a voice to read with: an action's boxes may be read on their own
  pieceSizes?: { first: number; rest: number }; // Speak's pieces, to read an answer as it streams (speech/growing)
  popClosed?: () => void; // the action's card went (widget/ui/actions-run: its boxes that wait are dropped)
  loaded: Map<string, WidgetOutputs>; // what the actions on page load found here
}

// The elements are set when the widget is built (before anything uses them).
export const widgetState = (site: string) => ({ site, place: {}, at: { x: 0, y: 0 }, actions: [], hovering: false, moving: false, selection: '', loaded: new Map() }) as unknown as WidgetState;

export const floats = (s: WidgetState) => !s.noFloating && s.chatWindow?.opens === 'floating';

// What the parts call back: show the widget as the state now says, and keep its place on the site.
export interface WidgetHost {
  render: () => void;
  savePlace: (patch: WidgetPlace) => Promise<void>;
}
