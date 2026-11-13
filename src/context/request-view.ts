// What a request carries of its conversation, built one way for the run (background/run-setup's
// LoopContext.view) and for the views that show the requests (ui/calls): what came earlier in the
// turn shortened first (Settings → Compaction → During a turn), more when it would not fit the model's
// window (`squeeze`, in the run only), then compacted (modelView).
import type { Message } from '../core/types';
import type { Settings } from '../storage/settings-types';
import { modelView } from './compaction';
import { inRunOf, squeezeRun, type Repeatable } from './in-run';

interface RequestSeen {
  elements?: ReadonlyMap<string, string>; // the page elements each action's result carried (the run only)
  squeeze?: 0 | 1 | 2;
  repeatable?: Repeatable;
}

// A view of one request (ui/calls/calls CallOptions.view): the system prompt and the conversation it carries.
export type RequestViewOf = (system: string | undefined, history: Message[]) => { system?: string; messages: Message[] };

export const requestView = (settings: Settings, system: string | undefined, messages: Message[], seen: RequestSeen = {}) =>
  modelView(system, squeezeRun(messages, inRunOf(settings.compaction?.inRun), seen));
