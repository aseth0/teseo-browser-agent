// The scenarios, in the order they run: they share the browser (its cookies, the permissions granted,
// the shop's tab), so the order is kept as it is, not taken from the tables. Each area fills the
// tables in scenarios/tables.mjs; they are imported in this order, so the tables fill as they did when
// they were one file.
import './core.mjs';
import './chat.mjs';
import './history-web.mjs';
import './custom-tools.mjs';
import './tools.mjs';
import './agents.mjs';
import './widget.mjs';
import './options.mjs';
import './manager.mjs';
import './popup.mjs';
import './shortcuts.mjs';
import './secrets.mjs';
import './voice.mjs';
import './speak.mjs';
import './devtools.mjs';
import * as tables from './tables.mjs';

export const ALL = [
  'stop', 'no-provider', 'scroll-reading', 'expand-mid-turn', 'agent', 'sub-agent', 'agent-mention', 'web-search', 'web-blocked', 'custom-tool',
  'custom-http', 'custom-session', 'custom-csrf', 'custom-sources', 'script-tool', 'script-steps', 'page-widget',
  'widget-agent', 'widget-prompt', 'widget-fold', 'widget-write', 'widget-load', 'widget-chat', 'widget-move',
  'widget-float-default', 'widget-sticky', 'history', 'temporary', 'history-tools', 'history-mention', 'history-auto', 'mentions-help',
  'user-ask', 'user-plan', 'user-pick', 'inline-mentions', 'limit-cut', 'message-actions', 'tool-groups',
  'view-grouped-steps', 'view-turn-diagrams', 'view-compact-tools', 'view-hidden-reasoning', 'mention-open', 'mention-background',
  'mention-failed', 'step-limit', 'page-template', 'agent-site', 'recording', 'recording-tool', 'recording-background', 'template-editor', 'skill-values', 'long-reply',
  'thinking', 'thinking-rejected', 'repetition-loop', 'chat-view', 'skill-catalog', 'site-skill', 'skill-editor', 'options-sync', 'about-user', 'collections-io',
  'markdown', 'fold-headings', 'context-usage', 'context-learned', 'context-retry', 'compaction', 'compaction-trim', 'compaction-tool', 'image-upload', 'pdf-attach', 'model-picker',
  'tools-offered', 'basic', 'error500', 'reasoning-field', 'page-context', 'context-persist', 'context-unchanged', 'tool-find',
  'tool-text', 'tool-structured', 'selection-chip', 'selection-skip', 'web-read', 'web-sign-in',
  'memory-prompt', 'memory-stable', 'memory-list', 'memory-settings', 'click-deny', 'click-allow-comment', 'click-deny-comment',
  'click-always', 'click-session', 'narrow-panel', 'type-submit', 'word-blacklist', 'word-blacklist-manual', 'dom-type', 'select-option', 'navigate', 'link-click', 'webmcp-allow', 'webmcp-navigate',
  'mcp', 'mcp-on-demand', 'tool-match', 'tool-match-unsure', 'tool-match-about', 'tool-match-always', 'tool-match-server', 'tool-meaning', 'tool-recommend', 'site-access', 'mcp-oauth', 'access-deny', 'find-other-tab', 'tech-view', 'skill-save', 'skill-edit',
  'template-save', 'template-edit', 'custom-save', 'custom-try', 'custom-edit', 'action-save', 'action-save-prompt', 'custom-http-post', 'agent-save',
  'memory-save', 'memory-delete', 'widget-turn-reload', 'widget-floating', 'agent-manager', 'panel-tools', 'panel-notice', 'fullscreen-chat', 'skill-edit-full', 'voice-dictate', 'voice-send', 'voice-floating', 'speak-command', 'speak-stop', 'speak-settings', 'speak-offscreen', 'action-popup', 'page-keys', 'secrets-isolated',
  'devtools-settings', 'engine-click', 'engine-type', 'engine-tab', 'engine-hover', 'engine-editor', 'engine-unfocused', 'engine-ignored', 'synthetic-editor', 'engine-rail', 'act-rail', 'engine-rail-still', 'act-rail-still', 'engine-rail-look', 'act-rail-look', 'rec-worker', 'rec-tabs', 'rec-hide-secret',
  'rec-gzip'
];

// Run only by name, with E2E_LIVE=1.
const LIVE_SCENARIOS = ['web-live'];
// Just a message and the mock's greeting: no table has anything for it.
const PLAIN = ['basic'];

// Every scenario a table has something for runs, and every scenario that runs is known: a name
// mistyped in a table, or one left out of ALL, fails here instead of passing unnoticed.
const named = new Set(Object.values(tables).flatMap((t) => Object.keys(t)));
const missing = [...named].filter((s) => !ALL.includes(s) && !LIVE_SCENARIOS.includes(s));
const unknown = ALL.filter((s) => !named.has(s) && !PLAIN.includes(s));
const twice = ALL.filter((s, i) => ALL.indexOf(s) !== i);
if (missing.length || unknown.length || twice.length) {
  throw new Error([
    missing.length && `in a table but not in ALL (scenarios/index.mjs): ${missing.join(', ')}`,
    unknown.length && `in ALL but in no table: ${unknown.join(', ')}`,
    twice.length && `twice in ALL: ${twice.join(', ')}`,
  ].filter(Boolean).join('; '));
}
