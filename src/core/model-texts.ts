// Every fixed text the model receives, as {placeholder} templates the user can override
// (Settings → Prompt preview; the tools' texts in Settings → Tools). Error messages are left
// where they are raised.
//
// The overrides are module state: each extension context (background, options page) sets
// them from its settings with setTextOverrides() before building anything with them.

// The definitions are in core/texts (one file per part of the request, and the registry of
// overrides), the origin marks in core/origin-marks, the cuts to fit in core/clip and core/truncate.

export { MCP_TEXTS, SHARED_REPLIES, WEBMCP_TEXTS, type TextDef, type TextGroup } from './texts/types';
export * from './texts/registry';
export * from './origin-marks';
export * from './truncate';
