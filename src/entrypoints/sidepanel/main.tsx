// The chat's page everywhere but floating on a page (that is floating.html): framed by a web page, nothing
// of it loads (ticket-gate); else the chat (chat-main).
import { startPanel } from './ticket-gate';

void startPanel(() => import('./chat-main')).catch((e: unknown) => console.error('[chat]', e));
