// The chat for a tab opened at once, inside the gesture (a click's message, a shortcut): the one
// floating there, unfolded, or the side panel. Where its handoff goes. For a stopped recording
// (background/recording-host) and a tab's audio (background/audio-host).
import { chatTarget } from '../capture/plan';
import { bestEffort } from '../core/errors';
import { sendTab } from '../core/runtime';
import { openSidePanel } from '../core/side-panel';
import { WIDGET_FLOAT, type HandoffTo } from '../widget/protocol';
import { floatingNow } from './floating-tabs';
import { panelFollowsNow } from './panel-mode';
import { panelShownIn } from './panel-windows';

export function openChat(tab: { id: number; windowId: number }): HandoffTo {
  const follows = panelFollowsNow();
  const { panel, to } = chatTarget(tab.id, floatingNow(tab.id), follows);
  if (panel) void openSidePanel(tab, follows, panelShownIn(tab.windowId), 'open-chat').catch((e: unknown) => console.error('[chat]', e));
  else void bestEffort(sendTab(tab.id, { type: WIDGET_FLOAT }), 'chat');
  return to;
}
