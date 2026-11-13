// What the top of each settings section holds (ui/SectionTop): its shortcuts and the size limits that
// apply to it. On its own, so that Settings → Limits (ui/LimitsSettings) can link each limit to its
// sections without importing the component that edits them.
import { AUDIO_COMMAND } from '../audio/protocol';
import { CAPTURE_COMMANDS } from '../capture/protocol';
import type { LimitId } from '../core/limits';
import { PANEL_COMMAND } from '../core/side-panel';
import { RECORDING_COMMAND } from '../recording/recorder-protocol';
import { SPEAK_COMMAND } from '../speech/protocol';
import { FLOAT_COMMAND, WIDGET_COMMAND } from '../widget/protocol';

interface SectionTopDef {
  title: string; // the section's, as Settings → Limits links to it
  shortcuts?: string[]; // commands (the manifest's)
  limits?: LimitId[];
  more?: LimitId[]; // folded under the others
}

// By section id (ui/Settings).
export const SECTION_TOPS: Record<string, SectionTopDef> = {
  'about-you': { title: 'About you', limits: ['aboutUser'] },
  skills: { title: 'Skills', limits: ['skillValue', 'skillItems'] },
  'site-templates': { title: 'Site templates', limits: ['templateOutput', 'mentions', 'renderDepth'] },
  'auto-inject': { title: 'Auto-inject', limits: ['pageBudget', 'pageElements', 'selection'] },
  memory: { title: 'Memory', limits: ['pinnedMemory', 'memory', 'siteMemoryItems'] },
  compaction: { title: 'Compaction', limits: ['summaryText'] },
  tools: {
    title: 'Tools',
    shortcuts: Object.values(CAPTURE_COMMANDS),
    limits: ['toolResult', 'imagesPerMessage', 'imageSize', 'attachedFile'],
    more: ['readPageElements', 'pageText', 'pageTextMax', 'structuredData', 'findInDomMatches', 'screenshotSize', 'waitFor', 'watches', 'watchMinutes', 'panelAgents', 'panelNotices', 'modelFirstByte', 'modelIdle', 'webmcpTools', 'webmcpDescription', 'webmcpSchema', 'webmcpResult', 'planReminder', 'planReminderAlways'],
  },
  'custom-tools': { title: 'Custom tools', limits: ['scriptTime', 'scriptSteps', 'scriptStepsTime'] },
  recording: { title: 'Recording', shortcuts: [RECORDING_COMMAND], limits: ['recording'] },
  actions: { title: 'Actions', limits: ['actionPageText'] },
  bubble: { title: 'Bubble', shortcuts: [WIDGET_COMMAND, FLOAT_COMMAND, PANEL_COMMAND] },
  history: { title: 'History', limits: ['historyAttach'] },
  speak: { title: 'Speak', shortcuts: [SPEAK_COMMAND], limits: ['speakText'] },
  voice: { title: 'Voice', shortcuts: [AUDIO_COMMAND], limits: ['tabAudio', 'tabAudioMinutes'] },
  'web-search': { title: 'Web search', limits: ['pageText'] },
};
