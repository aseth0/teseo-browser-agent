// What a compaction leaves out of the turns it trims (core/types Compaction.trimmed), and what
// Settings → Compaction trims (storage/settings-types): apart, so the settings' types need nothing of core/types.
export interface CompactionParts {
  pages: boolean;
  toolResults: boolean;
  screenshots: boolean;
  // None on a compaction made before they existed: it goes on leaving them as they are.
  replies?: boolean; // the model's long replies, their start kept
  toolArgs?: boolean; // the long arguments of tool calls
  attached?: boolean; // site skills and memory attached to your messages (they go again while they apply)
}
