import { expect, it, vi } from 'vitest';

// What a new profile's first request to Browser weighs, its tool definitions and system prompt as the
// previews and the background build them (estimated, context/usage): a guard so a new tool or a longer
// description cannot add a few thousand tokens to every request unnoticed. Raise it on purpose.
vi.mock('wxt/browser', async () => {
  const { fakeBrowser, fakeStorage } = await import('./fakes/browser');
  return { browser: fakeBrowser(fakeStorage()) };
});
const { readTools } = await import('../src/tools/browser/read-tools');
const { watchTools } = await import('../src/tools/browser/watch-tools');
const { writeTools } = await import('../src/tools/browser/write-tools');
const { userTools } = await import('../src/tools/user/user-tools');
const { historyTools } = await import('../src/history/tools');
const { memoryTools } = await import('../src/memory/tools');
const { webTools } = await import('../src/web/tools');
const { skillTools } = await import('../src/skills/tools');
const { templateTools } = await import('../src/templates/tools');
const { manageCustomTools } = await import('../src/tools/custom/manage');
const { actionTools } = await import('../src/widget/tools');
const { askTool } = await import('../src/agents/ask');
const { panelTools } = await import('../src/agents/panel');
const { agentTools } = await import('../src/agents/tools');
const { readMoreTool } = await import('../src/tools/read-more');
const { builderProfile } = await import('../src/agents/builder');
const { skillStore } = await import('../src/skills/store');
const { templateStore } = await import('../src/templates/store');
const { requestAs } = await import('../src/ui/request-parts');
const { buildSystemPrompt } = await import('../src/context/request');
const { estimateRequest } = await import('../src/context/usage');
const { DEFAULT_SYSTEM_PROMPT } = await import('../src/storage/settings-types');
type ToolInfo = import('../src/core/protocol').ToolInfo;

const MAX_TOOLS = 6500; // estimated tokens; ~6.1k on 0.72
const MAX_SYSTEM = 1200; // ~1.0k

it('keeps the first request of a new profile small', async () => {
  const none = async () => [];
  const catalog = [...readTools(), ...watchTools(), ...writeTools(), ...userTools(), ...historyTools(), ...memoryTools(), ...webTools(), ...skillTools(), ...templateTools(), ...manageCustomTools(none), ...actionTools(none), askTool(), ...panelTools(), ...agentTools(none), readMoreTool()] as ToolInfo[];
  const settings = { providers: [], systemPrompt: DEFAULT_SYSTEM_PROMPT };
  const [skills, templates] = await Promise.all([skillStore.load(), templateStore.load()]);
  const req = requestAs(undefined, settings, { skills, templates, catalog, agents: [builderProfile()], memory: [] });
  const system = buildSystemPrompt({ settings: req.settings, skills: req.skills, templates: req.templates, asksAgents: req.asks, memory: req.memory, heldSkills: req.heldSkills });
  const b = estimateRequest(system, req.specs, []);
  expect(req.specs.map((t) => t.name)).toContain('tools__load');
  expect(b.tools).toBeLessThan(MAX_TOOLS);
  expect(b.system).toBeLessThan(MAX_SYSTEM);
});
