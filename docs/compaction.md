# Compaction: what it does

How the extension keeps a conversation within the model's context window. Compaction proper runs in
the side panel before a message; the other savings act on every request. All of them change only
what is **sent**: the chat and the saved conversation keep every message whole. The wider map of a
request is [context.md](context.md).

## 1. When it runs

- **On its own, before a message** (`entrypoints/sidepanel/useCompaction.ts` `beforeSend`): when the
  context has reached the threshold (Settings → Compaction, default **80 %**) of the model's window.
- **By hand**: "Compact now" in the chat's context meter.
- **The window** is the model's as the meter knows it (set for the model, learned from a "too long"
  error, published by the server, set for the provider), else Settings → Compaction's window for an
  unknown one (default **72,000 tokens**; 0: it never compacts on its own then).
- **Who summarizes**: the model set in Settings → Compaction, else the chat's.

## 2. What it decides (`context/compaction.ts` `compactionStep`)

It aims at **half the threshold** (40 % of the window by default) and takes the first step that gets
there, each only when the one before does not:

1. The turns before the latest `keepTurns` (default **4**) **trimmed**.
2. The same turns **summarized** (when Summarize is on and a model can do it).
3. The same with fewer turns kept whole, down to one.
4. In the one turn left, **all but its last 4 messages trimmed** too (`inner`).

None reaching it: the last one, and the meter says how short it fell (`short`: where it got, the
target, and what the system prompt and tools take). Without a known window it compacts as
`keepTurns` says and summarizes only when asked by hand.

## 3. What a trim leaves out (`trimMessages`)

Each as a note, `compaction.trimmed`: `[{what} left out to save context: {chars} characters]`.
Settings → Compaction → Earlier turns → "Leave out", every one on by default:

| Part | Setting | What goes instead |
|---|---|---|
| Page blocks (the page, site templates, page values, mentions) over 400 chars | `pages` | `page content` note |
| Tool results over 400 chars (what went after them between steps stays) | `toolResults` | `the result of <tool>` note |
| Screenshots, and your images | `screenshots` | `a screenshot` / `an image` note |
| The model's replies over 1,400 chars | `replies` | their first 1,000 chars, then `the rest of this reply` note |
| Tool-call arguments over 400 chars (JSON) | `toolArgs` | `{"left_out": "<the arguments of this call note>"}` |
| Site skills and memory attached to your messages, over 400 chars | `attached` | `the site skill <name>` / `the skill <name>` / `memory items` note |

Never trimmed: **your typed text**, and short parts (under the sizes above). A compaction stores the
parts it trimmed (`Message.compaction.trimmed`); one made before `replies`, `toolArgs` and `attached`
existed goes on leaving those as they are, so its requests stay the same (prompt cache).

## 4. The summary

- The turns before the point go to the summarizing model as a transcript (trimmed as above, but with
  the model's replies whole), with `compaction.summary_request`, at most `maxWords` (default **400**).
- The summary replaces those turns: `compaction.summary` on the first message kept, and the system
  prompt gets `system.compaction` (what a summary block is).
- Not summarized (an error): the turns go trimmed only, and the chat says so.
- The latest plan with steps not done and not taken away by the user, when this took it from what the model gets (summarized, or its
  arguments trimmed): `compaction.plan` after the summary, built from the whole history on each request.

## 5. Where it is kept, and the cache

- The compaction is stored on the first message it keeps whole (`Message.compaction`), with when,
  how many turns, what it trimmed, the summary, and tokens before and after. The chat draws a
  divider there ("Compacted here · N turns · ~X → ~Y tokens").
- `compactedView` rebuilds the trimmed or summarized view from it on every request, the same way
  each time: what goes before it does not change from then on (the server's prompt cache breaks once).

## 6. What goes again after a compaction

What goes once per conversation is judged on what the model **still sees whole** (`seenWhole`), not
on the stored history. So a site skill, the memory for the site, memory changes, and the auto-attached
memory, bookmarks and conversations that a compaction trimmed or summarized go again with your next
message while they still apply. "Don't resend" notes stop pointing to copies that are gone.

## 7. The other savings, on every request

- **During a turn** (`context/in-run.ts` `shortenRun`, Settings → Compaction → During a turn): only the
  latest **3** tool results of the turn whole; earlier ones over 400 chars, older screenshots and older
  page-element lists as `run.left_out` notes; the results of calls not safe to repeat (writes, an
  agent's or the user's answer) stay whole.
- **Near the window** (`squeezeRun`, `core/agent-loop.ts`): a request estimated over **90 %** of the
  window goes with only the latest result whole (even with "During a turn" off), then also the turns
  before trimmed with every part above, and the results not safe to repeat as `run.left_out_kept`. A server's "too long" before the answer started sends it once
  more that way, and the rest of the run's requests too; the chat says so, and the window the server
  names is learned. Main chat and sub-agents alike.
- **Don't resend** (`context/dedupe.ts`, Settings → Compaction): a page block, site template output,
  `::site` mention or site skill values the same as the last one, and a mention, file, recording or
  image the same as one earlier, go as `context.unchanged` / `context.already_attached` while the
  model still sees that copy whole.
- **Memory kept per conversation** (`memory/prompt.ts`): the system prompt keeps the memory it started
  with; what changed since goes with your message (`memory.changes_block`).
- **Tools on demand** (`tools/load.ts`): `tools.load` instead of a group's tools, offered once the
  model loads them, for the rest of the conversation. The tools that create things for Default
  (Settings → Tools, on by default: about 7,000 tokens less in every request), and an MCP server's
  set so (Settings → MCP servers → Its tools on demand, off by default), for every agent. With the
  first come the skills that guide them (`CREATE_SKILLS`, while `skills.load` is offered: left out of
  the system prompt's skills while the group is held back, `heldSkills`, from the same groups as
  `withOnDemand`; named by `tools.load_skills`) and the whole `templates.run` (until then `TRIMMED`:
  its own description `tools.templates_run_saved`, `views` only named, a call with it refused with
  `tools.load_first`; in the same place, so the cache prefix holds). The previews (`ui/request-parts`
  `requestAs`) offer the same.

## 8. Not done

- No summary inside a run: a run near the window is shortened (§7), not summarized.
- Token counts are estimates (by script and image size, corrected per model from what its server
  reports: [context.md](context.md) §4), unless the server reports usage.
