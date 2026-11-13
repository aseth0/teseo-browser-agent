// The chat's icons: Lucide's, the set Settings draws with (text-pages' PAGE_ICONS), so a skill, a
// site template, a tool or a saved conversation looks the same in both.
import {
  Activity, ALargeSmall, AppWindow, Layers2, ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Ban, Bookmark, Bot, Brain, Camera, ChartGantt, Check, ChevronRight, Circle, CircleCheck, CircleDashed, CircleDot, Clock, CornerDownLeft, Eye,
  File as FileIcon, Folder, FolderUp, Hourglass, ImageOff, KeyRound, LayoutTemplate, Map, Maximize2, MessageSquare, Mic, MousePointerClick, PanelRight, Paperclip, Pencil,
  PictureInPicture2, Pin, RectangleHorizontal, ScrollText, ShieldCheck, SquareDashedMousePointer, Sparkles, Plug, Plus, Puzzle, Scissors, Settings, Square, Volume2, Download, TextCursorInput, TriangleAlert, Users, Wrench, X, Zap, type IconNode,
} from 'lucide';
import { LucideIcon } from './LucideIcon';

const CHAT_ICONS = {
  // The top bar.
  settings: Settings, textSize: ALargeSmall, history: Clock, memory: Brain, bookmark: Bookmark, folder: Folder, folderUp: FolderUp, temporary: Hourglass, panel: PanelRight, float: PictureInPicture2, watch: Eye, autoInject: Sparkles,
  // The agent manager: opened from the top bar (the popup's row, with its chevron); a row's "go to its tab". The chat in a tab.
  agents: Users, chevron: ChevronRight, goTo: ArrowUpRight, fullChat: Maximize2,
  // What a message has or attaches, as in Settings.
  skill: Zap, template: LayoutTemplate, tool: Wrench, mcp: Plug, agent: Bot, thought: Brain, pageTools: Puzzle, selection: TextCursorInput, blacklist: ShieldCheck,
  // The message box.
  newChat: Plus, attach: Paperclip, file: FileIcon, capture: Camera, record: CircleDot, stop: Square, close: X, mic: Mic,
  // The popup's screenshots into the chat: a section dragged on the page, its visible part, the whole page.
  section: SquareDashedMousePointer, visible: RectangleHorizontal, fullPage: ScrollText,
  // A recording's modes on the DevTools engine: this tab, several tabs, and the user's clicks and typing too.
  recordTab: AppWindow, recordTabs: Layers2, recordMouse: MousePointerClick,
  // The popup's line that records a page's requests.
  requests: Activity,
  // A tab's audio, and saving it to a file.
  audio: Volume2, save: Download,
  // A step back (the recording review's Make a tool step).
  back: ArrowLeft,
  // A tool call and its result.
  ok: Check, error: TriangleAlert, result: CornerDownLeft, tab: AppWindow, comment: MessageSquare, imageGone: ImageOff, withheld: Ban, cut: Scissors,
  sent: ArrowUp, received: ArrowDown,
  // A turn's diagram (the Diagrams view: Show the chat as).
  diagram: ChartGantt,
  // The history and the cards.
  pin: Pin, rename: Pencil, key: KeyRound, pick: MousePointerClick, plan: Map, pending: Circle, doing: CircleDashed, done: CircleCheck,
} satisfies Record<string, IconNode>;
export type ChatIconName = keyof typeof CHAT_ICONS;

// One of them, sized to the text it goes with (the label stays as text, for screen readers too).
export const Icon = ({ name, size = 14 }: { name: ChatIconName; size?: number }) => (
  <span className="chat-icon"><LucideIcon node={CHAT_ICONS[name]} size={size} /></span>
);
