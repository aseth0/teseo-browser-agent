// How far the estimates (context/budget) are from what a model's server reports, learned per model from
// every call it reports: the estimates for that model are multiplied by it (the context meter, compaction,
// the agent loop's room in the window). None: as estimated.
import type { CallUsage } from '../core/types';
import { modelMap } from './model-map';
import { estimatedInput } from './usage';

const ratios = modelMap('tokenRatios'); // storage.local: reported / estimated input tokens, by model
const RANGE = [0.5, 2.5] as const;
const WEIGHT = 0.3; // of each new call against what was learned before
const LEAST = 200; // estimated tokens of a request below which it says too little
const IMAGES_AT_MOST = 0.1; // of the text's estimate: past it, the images' error would say more than the text

const within = (r: number) => Math.min(RANGE[1], Math.max(RANGE[0], r));

// What is learned after a call: from none, its ratio; else moved toward it.
export function nextRatio(before: number | undefined, reported: number, estimated: number): number | undefined {
  if (estimated < LEAST || !(reported > 0)) return before;
  const now = within(reported / estimated);
  return before === undefined ? now : within(before * (1 - WEIGHT) + now * WEIGHT);
}

// From a call the server reported, how far its estimate was: of the text only, the images' estimate
// taken from both sides. Their cost differs widely by provider (a screenshot: from a few hundred tokens
// to over a thousand), and the ratio corrects every text estimate; a call whose images weigh more than
// a little teaches nothing.
export async function learnFromCall(providerId: string, model: string, usage: CallUsage): Promise<void> {
  if (!usage.reported) return;
  const images = usage.estimatedImages ?? 0;
  const text = estimatedInput(usage.breakdown) - images;
  if (images <= text * IMAGES_AT_MOST) await learnTokenRatio(providerId, model, usage.reported.input - images, text);
}

export const learnTokenRatio = (providerId: string, model: string, reported: number, estimated: number): Promise<void> =>
  ratios.change(providerId, model, (before) => nextRatio(before, reported, estimated));

export const tokenRatios = ratios.all;
export const tokenRatioOf = ratios.of;
export const onTokenRatios = ratios.onChanged;
export const forgetTokenRatio = (key: string) => ratios.forget(key);
