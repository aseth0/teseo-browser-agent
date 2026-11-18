import { AboutYouSection } from './AboutYouSettings';
import { AutoInjectSection } from './AutoInjectSettings';
import { BookmarksSection } from './BookmarksSettings';
import type { ReactNode } from 'react';
import { BubbleSection } from './bubble/BubbleSettings';
import { AppearanceSection } from './AppearanceSettings';
import { DisplaySection } from './DisplaySettings';
import { CustomToolsSection } from './custom-tools/Section';
import { ActionsSection } from './widget-actions/Section';
import { AgentsSection } from './agents/AgentsSection';
import { HistorySection } from './HistorySettings';
import { LogsSection } from './LogsSettings';
import { AlertsSection } from './AlertsSettings';
import { ExportImportSection } from './export-import/Section';
import { WebSearchSection } from './WebSearchSettings';
import { WordBlacklistSection } from './WordBlacklistSettings';
import { RecordingSection } from './RecordingSettings';
import { DevtoolsSection } from './DevtoolsSettings';
import { ShortcutsSection } from './ShortcutsSettings';
import { VoiceSection } from './VoiceSettings';
import { SpeakSection } from './speak/SpeakSection';
import { speakAvailable, type FeatureId } from '../core/build';
import { AboutSection } from './AboutSettings';
import { FeaturePage } from './FeatureNotice';
import { LimitsSection } from './LimitsSettings';
import { MemorySection } from './Memory';
import { CompactionSection } from './CompactionSettings';
import { McpSection } from './mcp/McpSection';
import { PromptPreview } from './PromptPreview';
import { SiteTemplatesSection } from './templates/SiteTemplatesSection';
import { SkillsSection } from './Skills';
import { ToolSettings } from './ToolSettings';
import type { SectionProps as Props } from './useSettings';
import { ProvidersSection } from './ProvidersSettings';
import { SitePoliciesSection, WebAccess } from './WebAccessSettings';

// Every settings section, in display order (the options page builds its menu from this).
// The first one is the landing page of the options (with your system prompt). Then the groups: what the model gets
// (about you, agents, compaction, the limits on all of it, the word blacklist), RAG (what is looked up and attached:
// auto-inject first, as it gathers the auto-attach of those after it: memory, skills, site templates, bookmarks, history), the tools
// (built-in and custom, MCP servers, DevTools, the page widget's actions), the chat, audio (dictation and a tab's audio, reading
// aloud), and connections and access. `group`
// starts a group in the menu, under a divider with its name. `feature`: what the section is about, which a
// build may lack (core/build): the menu marks it there, and the section says why (ui/FeatureNotice).
// About, last: the version, the project's links and what this version leaves out.
export const SETTINGS_SECTIONS: { id: string; title: string; group?: string; feature?: FeatureId; render: (p: Props) => ReactNode }[] = [
  { id: 'prompt', title: 'Prompt preview', render: (p) => <PromptPreview {...p} /> },
  { id: 'about-you', title: 'About you', group: 'What the model gets', render: (p) => <AboutYouSection {...p} /> },
  { id: 'agents', title: 'Agents', render: (p) => <AgentsSection {...p} /> },
  { id: 'compaction', title: 'Compaction', render: (p) => <CompactionSection {...p} /> },
  { id: 'limits', title: 'Limits', render: (p) => <LimitsSection {...p} /> },
  { id: 'word-blacklist', title: 'Word blacklist', render: (p) => <WordBlacklistSection {...p} /> },
  { id: 'auto-inject', title: 'Auto-inject', group: 'RAG', render: (p) => <AutoInjectSection {...p} /> },
  { id: 'memory', title: 'Memory', render: (p) => <MemorySection {...p} /> },
  { id: 'skills', title: 'Skills', render: () => <SkillsSection /> },
  { id: 'site-templates', title: 'Site templates', render: (p) => <SiteTemplatesSection {...p} /> },
  { id: 'bookmarks', title: 'Bookmarks', render: (p) => <BookmarksSection {...p} /> },
  { id: 'history', title: 'History', render: (p) => <HistorySection {...p} /> },
  { id: 'tools', title: 'Tools', group: 'Tools', render: (p) => <ToolSettings {...p} /> },
  { id: 'custom-tools', title: 'Custom tools', render: () => <CustomToolsSection /> },
  { id: 'mcp', title: 'MCP servers', render: (p) => <McpSection {...p} /> },
  { id: 'devtools', title: 'Chromium DevTools', feature: 'devtools', render: (p) => <DevtoolsSection {...p} /> },
  { id: 'recording', title: 'Recording', render: (p) => <RecordingSection {...p} /> },
  { id: 'actions', title: 'Actions', render: () => <ActionsSection /> },
  { id: 'appearance', title: 'Appearance', group: 'Chat', render: (p) => <AppearanceSection {...p} /> },
  { id: 'display', title: 'Display', render: (p) => <DisplaySection {...p} /> },
  { id: 'shortcuts', title: 'Shortcuts', render: () => <ShortcutsSection /> },
  { id: 'bubble', title: 'Bubble', render: (p) => <BubbleSection {...p} /> },
  { id: 'alerts', title: 'Alerts', render: (p) => <AlertsSection {...p} /> },
  { id: 'voice', title: 'Voice', group: 'Audio', render: (p) => <VoiceSection {...p} /> },
  // Where there is no offscreen document to play in (Firefox: core/build), it says so instead.
  { id: 'speak', title: 'Speak', feature: 'speak', render: (p) => (speakAvailable() ? <SpeakSection {...p} /> : <FeaturePage id="speak" title="Speak" />) },
  { id: 'providers', title: 'Providers', group: 'Connections and access', render: (p) => <ProvidersSection {...p} /> },
  { id: 'web-search', title: 'Web search', render: (p) => <WebSearchSection {...p} /> },
  { id: 'web-access', title: 'Website access', render: () => <WebAccess /> },
  { id: 'site-policies', title: 'Site policies', render: () => <SitePoliciesSection /> },
  { id: 'logs', title: 'Logs', render: (p) => <LogsSection {...p} /> },
  { id: 'export-import', title: 'Export and import', render: () => <ExportImportSection /> },
  { id: 'about', title: 'About', group: 'Teseo', render: (p) => <AboutSection {...p} /> },
];
