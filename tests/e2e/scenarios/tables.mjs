// The scenarios' tables, by scenario name: scenarios/<area>.mjs fill them, the run reads them.

export const EXPECT = {}; // the UI text expected, by scenario or by model (default: the greeting)
export const BEFORE = {}; // UI steps before the prompt is sent
export const AFTER = {}; // checks after the answer
export const MEMORY = {}; // memory items stored
export const SKILLS = {}; // the user's skills
export const TEMPLATES = {}; // the user's site templates
export const MESSAGES = {}; // the message sent (default: hello N; null: Enter on what the composer has)
export const MODEL_OF = {}; // the mock model, when it is not the scenario's name
export const CHAT_VIEW = {}; // Settings → Appearance → Chat
export const REJECT = {}; // text that must not be shown
export const DISABLED_TOOLS = {}; // tools switched off
export const CONVERSATIONS = {}; // saved conversations
export const WEB_SEARCH = {}; // Settings → Web search
export const CUSTOM_TOOLS = {}; // the user's custom tools
export const LIMITS = {}; // Settings → Limits
export const SITE_POLICIES = {}; // site policies
export const TURNS = {}; // messages sent, by model (default 1)
export const BETWEEN = {}; // steps before each message after the first (page, its turn from 1)
export const MID_TURN = {}; // true: AFTER steps in while the turn still runs, or answers its card (its end is not waited for)
export const ACTIONS = {}; // scenarios answered in a confirmation card
export const CARD = {}; // checks of an ACTIONS scenario's card before it is answered ({ page, errors })
export const AGENT_PROFILES = {}; // agents
export const PAGE_ACTIONS = {}; // the page widget's actions
export const APPEARANCE = {}; // Settings → Appearance
export const COMPACTION = {}; // Settings → Compaction
export const CHAT_WINDOW = {}; // Settings → Appearance → Chat window
export const WORD_BLACKLIST = {}; // Settings → Word blacklist: { config, entries }
export const VOICE = {}; // Settings → Voice
export const SPEAK = {}; // Settings → Speak
// Steps of a scenario at its own place in the run: RUN before the prompt is sent, CHECK once the chat's
// text is read. Each gets { page, errors, ctx, extId, shop, sw, policySelect, action, model } (CHECK: page, errors).
export const RUN = {};
export const CHECK = {};
// The page each scenario starts on (default: /shop.html).
export const PAGES = { 'site-access': '/mm.html', 'limit-cut': '/big.html', 'webmcp-allow': '/webmcp.html', 'tool-groups': '/webmcp.html' };
