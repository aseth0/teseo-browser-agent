// Storage keys read by more than one part of the extension, kept apart so a reader needs nothing else.

// What the widget needs from the settings (storage/settings WidgetSettings), under a key of its own:
// the widget runs on web pages, which need nothing else of them (prompts, servers, agents).
export const WIDGET_SETTINGS_KEY = 'widgetSettings';

// The keys set in Settings → Shortcuts (shortcuts/keys PageKeys), read by the pages they are pressed in.
export const PAGE_KEYS_KEY = 'pageKeys';
