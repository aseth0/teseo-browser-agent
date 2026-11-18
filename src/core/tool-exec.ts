// One tool call of the model's, run: the policy first, a permission asked for when the tool lacks one,
// and its result as the model gets it; every call logged as it ends (LoopHooks.log).
import type { LoopOptions } from './agent-loop';
import { errorText } from './errors';
import { cutAndKeep } from './kept-results';
import { text } from './model-texts';
import { closestNames } from './similar';
import { checkArgs, coerceArgs, problemLine, wireArgsError } from './tool-args';
import type { ToolRegistry } from './tool-registry';
import { AccessRequiredError, type Authorization, type EditedValue, type ImagePayload, type SubTrace, type ToolContext, type ToolResult } from './types';

type Serialized = { content: string; isError?: boolean; images?: ImagePayload[]; userComment?: string; trace?: SubTrace; data?: unknown; elements?: string; devtools?: true }; // data: for tool() only, elements: for the view, never kept

export async function execute(opts: LoopOptions, tools: ToolRegistry, name: string, given: unknown, ctx: ToolContext): Promise<Serialized> {
  const at = Date.now();
  const tool = tools.get(name);
  let auth: Authorization = {};
  const done = (result: Serialized, refused?: string): Serialized => {
    opts.hooks?.log?.({
      tool: tool?.name ?? name, at, ms: Date.now() - at, seen: auth.seen,
      ...(refused ? { refused } : result.isError ? { error: result.content } : { size: result.content.length }),
    });
    return result;
  };
  if (!tool) {
    // One this build lacks (LoopTools.lacking): said so, not that it is unknown.
    const lacks = opts.tools.lacking?.(name);
    if (lacks) {
      // No tool belongs to a feature Firefox's build leaves out by choice (core/build FIREFOX_LEAVES_OUT: only
      // the sources of custom tools, not a tool): one that does would need a text of its own here.
      const id = lacks.reason === 'store' ? 'result.tool_not_in_store_build' : 'result.tool_not_in_browser';
      return done({ content: text(id, { name, feature: lacks.name }), isError: true }, 'not in this version');
    }
    return done({ content: text('result.unknown_tool', { name }) + offeredLike(tools, name), isError: true }, 'unknown tool');
  }
  // Arguments that are not JSON, or none where some are required: said as such, not as left out.
  // What to do for each required argument left out that the tool has a hint for (browser.type's ref).
  const hintsFor = (names: string[]) => names.flatMap((n) => (tool.missingHints?.[n] ? [`\n- ${n}: ${tool.missingHints[n]}`] : [])).join('');
  const wireError = wireArgsError(tool.inputSchema, given);
  if (wireError) return done({ content: wireError.content + hintsFor(wireError.missing), isError: true }, wireError.reason);
  // What a model sends in another form ("5" for 5, JSON text for a list), read as its schema says
  // (core/tool-args); for the policy's card too.
  const args = coerceArgs(tool.inputSchema, given);
  // What does not fit its schema, said with what to fix, before anything runs.
  const { missing, invalid } = checkArgs(tool.inputSchema, args);
  if (invalid.length) {
    const all = [...missing.map((at) => ({ at, problem: 'required, left out' })), ...invalid];
    const problems = all.map((p) => `- ${problemLine(p)}`).join('\n');
    return done({ content: text('result.invalid_args', { problems }), isError: true }, `invalid ${all.map((p) => p.at).join(', ')}`);
  }
  if (missing.length) {
    return done({ content: text('result.missing_args', { names: missing.join(', ') }) + hintsFor(missing), isError: true }, `missing ${missing.join(', ')}`);
  }
  try {
    // Every call goes through the policy: write tools, and reads on a tab other than the panel's.
    const { authorize } = opts.tools;
    if (authorize) auth = await withAccess(opts, () => authorize(tool, args, ctx));
    if (auth.refused) return done({ content: text('result.not_executed', { reason: auth.refused }), isError: true, userComment: auth.comment }, auth.refused);
    const allowed = auth.approvedHost ? { ...ctx, approvedHost: auth.approvedHost } : ctx;
    // Cut at Settings → Limits, the whole kept for tools.read_more.
    const cut = (s: string) => cutAndKeep(s, 'toolResult', { conversationId: ctx.conversationId, source: tool.name });
    // Run on the DevTools engine: said with its result, for the chat (refused calls never ran).
    const ran = { ...serialize(await withAccess(opts, () => tool.run(auth.args ?? args, allowed)), cut), ...(tool.via === 'devtools' && { devtools: true as const }) };
    // What the user edited, then their comment, go first, so a long result does not bury them.
    const result = auth.edited?.length ? { ...ran, content: text('result.user_edited', { changes: editedText(auth.edited), result: ran.content }) } : ran;
    return done(auth.comment ? { ...result, content: text('result.user_comment', { comment: auth.comment, result: result.content }), userComment: auth.comment } : result);
  } catch (e) {
    return done({ content: errorText(e), isError: true, ...(tool.via === 'devtools' && { devtools: true as const }) });
  }
}

const SHOWN = 5; // tool names an unknown tool's reply lists

// After an unknown tool's reply: the offered tools most like it, as the model calls them, else a few
// of those offered.
function offeredLike(tools: ToolRegistry, written: string): string {
  const names = tools.wireNames();
  if (!names.length) return '\nNo tools are offered: answer without them.';
  const listed = (list: string[], rest: string) => list.slice(0, SHOWN).join(', ') + (list.length > SHOWN ? `, and ${list.length - SHOWN} more ${rest}` : '');
  const like = closestNames(names, written, Infinity);
  return like.length ? `\nDid you mean: ${listed(like, 'like it')}?` : `\nTools offered include: ${listed(names, 'in your tool list')}.`;
}

// Each field the user edited: its label, then its line diff.
const editedText = (edited: EditedValue[]) => edited.map((e) => `${e.label}:\n${e.diff}`).join('\n');

// A tool that lacks a permission the user can grant runs again once it is granted; so does the
// description of a call that tries it first (actions.save).
async function withAccess<T>(opts: LoopOptions, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    const { requestAccess } = opts.tools;
    if (e instanceof AccessRequiredError && requestAccess && (await requestAccess(e.access))) return step();
    throw e;
  }
}

function serialize(r: ToolResult, cut: (s: string) => string): Serialized {
  switch (r.type) {
    case 'text':
      return { content: cut(r.text), isError: r.isError, userComment: r.userComment, ...(r.trace && { trace: r.trace }), ...(r.data !== undefined && { data: r.data }), ...(r.elements && { elements: r.elements }) };
    case 'json':
      return { content: cut(JSON.stringify(r.value, null, 2)), data: r.value };
    case 'image':
      return { content: r.note ? `${text('result.screenshot')} ${r.note}` : text('result.screenshot'), images: [{ mediaType: r.mediaType, data: r.data }] };
  }
}
