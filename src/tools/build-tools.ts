// The tools a build may lack (core/build): the DevTools engine's own (tools/browser/engine-only) and
// speech.say, which plays in Speak's offscreen document. Where the feature is missing they are not in the
// catalog: Settings → Tools lists them greyed under their group, with why, and a call to one gets a reply
// saying it is not in this version (lackedBy, given to the loop: core/tool-exec), not that the tool is unknown.
import { feature, type Feature, type FeatureId } from '../core/build';
import { toolNamed } from '../core/tool-registry';
import { SAY_TOOL } from '../speech/protocol';
import { ENGINE_ONLY_TOOLS } from './browser/engine-only';

export interface BuildTool { name: string; about: string; feature: FeatureId; group: string }

export const BUILD_TOOLS: readonly BuildTool[] = [
  ...Object.entries(ENGINE_ONLY_TOOLS).map(([name, about]): BuildTool => ({ name, about, feature: 'devtools', group: 'browser' })),
  { name: SAY_TOOL, about: "Reads a text aloud to the user with the agent's voice, when its switch is on (Settings → Agents).", feature: 'speak', group: 'speech' },
];

// The ones this build and browser lack, each with its feature (and why).
export const missingTools = (): (BuildTool & { lacks: Feature })[] =>
  BUILD_TOOLS.map((t) => ({ ...t, lacks: feature(t.feature) })).filter((t) => !t.lacks.available);

// The feature a tool the model called needs, by its wire name, when this build lacks it.
export const lackedBy = (wireName: string): Feature | undefined => missingTools().find((t) => toolNamed([t.name])(wireName))?.lacks;
