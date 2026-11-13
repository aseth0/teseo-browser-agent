// "Open in the side panel" on the floating chat's bar (widget/ui/floating-chat, WIDGET_TO_PANEL): the
// side panel opened at once, inside the click (its gesture only lasts that long), as the bubble opens
// it; then the chat floating on that tab hands its conversation over (FLOATING_TO_PANEL), which the
// panel takes once open, or later when the browser did not let the click open it.
import { chatTarget } from '../capture/plan';
import { openSidePanel } from '../core/side-panel';
import { sendRuntime } from '../core/runtime';
import { FLOATING_TO_PANEL } from '../widget/protocol';
import { panelShownIn } from './panel-windows';

// `follows`: the chat's pin (core/side-panel): the window's panel, or the tab's own; undefined, not known yet.
export async function floatToPanel(tab: { id: number; windowId: number }, follows: boolean | undefined): Promise<{ opened: boolean; moved: boolean }> {
  const opened = await openSidePanel(tab, follows, panelShownIn(tab.windowId), 'float-to-panel').then(() => true, () => false);
  const reply = await sendRuntime({ type: FLOATING_TO_PANEL, tab: tab.id, to: chatTarget(tab.id, false, follows).to, opened }).catch(() => undefined);
  return { opened, moved: reply?.moved === true };
}
