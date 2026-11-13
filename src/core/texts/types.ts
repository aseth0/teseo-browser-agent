// What a fixed text is: its group, where it is edited, and its default (core/model-texts).

import type { LimitId } from '../limits';

export type TextGroup = 'system' | 'user' | 'replies' | 'webmcp' | 'mcp' | 'compaction'; // compaction: edited in Settings → Compaction

// Replies to tool calls belong to a tool (dotted name), to every tool that acts on the page
// ('shared'), or to the tools websites register ('webmcp'); they are edited in Settings → Tools.
export const SHARED_REPLIES = 'shared';
export const WEBMCP_TEXTS = 'webmcp';
export const MCP_TEXTS = 'mcp'; // owner of the texts that wrap MCP servers' tools

export interface TextDef {
  group: TextGroup;
  label: string;
  text: string; // default; its {placeholders} are required in an override
  when?: string; // condition for sending it; none = always
  note?: string; // extra explanation
  tool?: string; // owner, for replies to tool calls
  warning?: string; // shown while editing
  limit?: LimitId; // the size limit on what it carries (core/limits)
}

export const UNTRUSTED_WARNING =
  'This text protects against prompt injection (instructions hidden in web pages). Weakening it lets pages steer the model.';
export const TAG_WARNING =
  'The page instructions refer to this tag by name: if you rename it, update them too.';
