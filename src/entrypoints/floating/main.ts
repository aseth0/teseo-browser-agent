// floating.html: the chat floating on a page, in the page widget's iframe (widget/ui/floating-chat). The
// only page of the extension a web page can load (web-accessible, manifest): nothing of the chat loads
// before its ticket is redeemed (sidepanel/ticket-gate), and never in a tab of its own. Then the same
// chat app as the side panel's, floating (ui/floating-frame FLOATING).
import { startFloating } from '../sidepanel/ticket-gate';

void startFloating(() => import('../sidepanel/chat-main')).catch((e: unknown) => console.error('[chat]', e));
