# Model context: what each request carries and how big it gets

The map of everything that decides what goes to the model on each request and its size. Keep it
current with every change to these files. References name the file and the function (line numbers
went out of date with every change).

## 1. One request, end to end

```
panel send (useSendPipeline) ──► compaction.beforeSend (auto-compact, panel side)
   │  + your files / recording as context parts
   ▼
background runAgent (background/agent-run.ts)
   │  prepareAgent → system prompt, tool registry (background/run-setup.ts)
   │  turnContext → context items appended to your message (context/turn.ts)
   ▼
runAgentLoop (core/agent-loop.ts), per step:
   view = modelView(system, squeezeRun(messages, inRun, elements, squeeze))   (run-setup.ts)
          ├ squeeze 1, then 2, while the estimate is over 90 % of the run's window (§3.2)
          └ compactedView → dedupeContext → system.compaction / user.stopped
   provider.chat({system, messages, tools: specs})                 (agent-loop.ts)
   measure → usage event (context/usage.ts)
   tool calls → results (cut to toolResult) + step attach (agent-loop.ts)
```

### 1.1 Panel side
- `entrypoints/sidepanel/useSendPipeline.ts` runs `compaction.beforeSend()` first, then
  `applyModelSettings`, then adds what *you* attached: a recording (`recording/block.ts`,
  `recording.block`, cap `recording`) and files (`context/attached-file.ts` `filePart`,
  `file.block`, cap `attachedFile`; a file cut goes whole with the `run` message as `kept`, for
  `tools.read_more`). A PDF (`pdfPart`, source `pdf:<name>`) goes the same way as its pages' text,
  each after `pdf.page`, cut at a page's start when it can (`KeptText.breaks`); with no text layer,
  as `pdf.scanned` and images of its first pages (`entrypoints/sidepanel/pdf.ts`). A saved
  conversation keeps `pdf.not_kept` in place of its text (`history/store.ts` `keptHistory`).
  All are `context: 'page'` parts; `attachedByYou`
  (`core/sources.ts`) keeps them when a message is resent. Your images go as `image` parts
  (caps `imagesPerMessage`, `imageSize`).
- The history is append-only: the background sends a `context` event with the items it added, and
  the panel appends the same parts (`core/messages.ts` `appendContext`).

### 1.2 Run setup (background)
- `background/agent-run.ts` `runAgent`: loads skills, templates, agents, memory; `toolsFor` builds
  the registry for the tab; `prepareAgent` (`run-setup.ts`) filters per agent and builds the
  system prompt (`run-setup.ts`).
- Unless EmptyAgent, `turnContext` (`agent-run.ts`) collects the items and `appendContext` puts
  them on your message (`agent-run.ts`). The page is skipped with a reason (`context.no_page*`,
  `agent-run.ts`).
- `excludedTools` (`context/request.ts`): disabled tools, skills tools without general skills,
  history tools with history off, memory tools with memory off; `$tool` mentions bring one back.
- `loopOptions` (`run-setup.ts`) is shared by the chat and sub-agents, grouped as `model`, `context`,
  `tools` and `hooks`: `context.view` = `requestView` (`context/request-view.ts`: in-run shortening then
  `modelView`; the Calls view builds the same); `context.measure` = `measureCall`; `tools.refresh` =
  WebMCP follows the tab; `tools.context` = what every call's `ToolContext` gets, the run's settings too.
- `context.attachAfter` (`agent-run.ts`) = `stepAttachItems` (chat only, not EmptyAgent, not sub-agents).

### 1.3 System prompt (`context/request.ts` `systemPromptParts`)
In order, blank-line separated: your system prompt · agent instructions (`system.agent`) · page
instructions (`system.page`, only with browser tools) · `system.mcp` · `system.agents` ·
`system.history` · skills catalog (`skills/prompt.ts`: `system.skills_header`,
`system.skills_item` per general skill, `system.site_skills`) · `system.templates` · memory
(`memory/prompt.ts`: `system.memory`, pinned items whole up to `pinnedMemory`, index up to
`memory`). EmptyAgent: your system prompt only. `system.compaction` is appended by `modelView` once
a summary exists. Built once per run (so memory saved in a run shows next run).

**Memory kept per conversation** (`memory/prompt.ts` `keepMemory`/`keptMemory`/`memoryChanges`): the
chat's agent keeps the memory part it started with on your message (`Message.systemMemory`, event
`system-memory`), so the system prompt stays the same turn after turn (prefix cache). It is built again
when its key changes (another agent, memory or its read/save tools switched). What changed since goes
with your message in `memory.changes_block` (edited/new pinned whole, others as index lines,
`memory.deleted_item`), each change once on `seenWhole`. Sub-agents build it per run, as before.

### 1.4 Per-message context (`context/turn.ts` `turnContext`), in order
1. **Site skills** of the page (`context/site-context.ts`, `skills/prompt.ts`): full
   `skill.site_block` the first time in the conversation (source = skill name, `context: 'skill'`),
   `skill.reminder` on later turns.

**"Once per conversation" is judged on what the model sees** (`seenWhole`, `context/compaction.ts`,
after `compactedView`): `turnContext` works it out once per turn (`context/turn.ts`) and passes it as
`history` to `siteContextItems` (site skill block vs reminder, site memory, memory auto), bookmark
auto and history auto; `stepAttachItems` does the same per step. A context text part counts only if
compaction left it whole (the same part object as stored); a summary drops everything before it.
Compaction trims only page-kind parts, so after a *trim* skill and memory blocks still count and
long auto-attached saved conversations or bookmarks may go again; after a *summary* everything goes
again (full skill block, site memory, matches). In-run shortening keeps step-attached text, so it
still counts. Tests: `tests/once-seen.test.ts`; e2e `compaction` checks the full block after a summary.
2. **Memory for the open site** (`memory/prompt.ts` `memorySiteItems`). With `autoInject.memorySiteMatch`
   (unset: on) and an agent with `memory.read` (`memoryOpts.reads`, passed to `siteContextItems`):
   - `memory.site_block`, whole, not yet sent as they are now: the pinned, then those the typed text
     matches (`siteMemoryMatches`, best first, at `memory.autoAttach.threshold` or
     `MEMORY_AUTO_DEFAULTS.threshold`, also with Auto-attach off), then those that went whole in an
     older text (`wentWholeOnce`), which the model would otherwise keep as they were. At most
     `siteMemoryItems`; those past it go by title for now.
   - `memory.site_index_block`, `memory.index_item` lines of the rest, each once (source
     `memoryIndexSource`, with the titles for the chip). Cut to `memory` characters, with
     `memory.index_more`; the lines left out go with a later message. Not for an item already whole.
   - `siteMemoryMatches` scores title and text only and drops the site's name from the typed text, so
     naming the site matches nothing ("com" would find "come"). Rarity comes from all the agent's items
     (`scored`'s `corpus`): among a site's few, any shared word would be a full match. An empty text
     matches nothing.
   - Every auto-attach (this, memory, bookmarks, history; with a message or between steps) and the
     playgrounds that show it score with `scored`'s `unseen` at `ATTACH_UNSEEN` (0.5,
     `storage/settings-types`): each typed word no item has counts in the full match as half the idf of
     a word only one item has, so one shared word in a long message is no full match. The model's
     searches (`memory__search`, `history.search`, `bookmarks.search`) and the search boxes leave it
     at 0: a query finds by any of its words.
   - An item that went only by title and whose text changed goes no line again: the index line is the same.

   Switch off or no `memory.read`: every item whole, latest first, at most `siteMemoryItems` per
   message (the rest later), and no index. `memoryChanges` covers only items without domains.
3. **Memory auto-attach** (`memory/prompt.ts`, `memory.auto_block`), off by default. With Semantic search on
   (below), those that pass only by meaning go in `memory.meaning_block`, in the same maximum.
4. **`::site/view` mentions** (`context/mentions.ts`), at most `mentions` per message; may
   replace the page's elements (`replacedBy`).
5. **`/skill` mentions** (`context/inline-mentions.ts`).
6. **`#conversation` mentions** (`history/mention.ts`, `history.mention_note`, cap `historyAttach`).
7. **`b::bookmark` mentions** (`bookmarks/mention.ts`) and bookmark auto-attach
   (`bookmarks/auto.ts`, `bookmark.auto_note`).
8. **History auto-attach** (`history/auto.ts`, `history.auto_note`), once per chat.
9. **`$tool` mention note** (`inline-mentions.ts`).
10. With "Page" on: site skill values (`skills/prompt.ts`, `skill.values`, caps `skillValue`,
    `skillItems`), site template output (`templates/render`, `template.data`, cap
    `templateOutput`), then the **page block** (`context/pipeline.ts` → `page-context.ts`):
    `page.meta` (100) > `page.selection` (90, cap `selection`) > `page.elements` (50, cap
    `pageElements` = 300) fitted by `fitBlocks` into `pageBudget` = 1500 tokens, wrapped in
    `page.block`. Without the page: `context.no_page`. When you are on another tab than the chat's
    (the window's side panel): `context.user_elsewhere`, that tab's id, title and URL.

11. **Tool matching** (`tools/match-turn.ts`, after `turnContext` in `background/agent-run.ts`; chat's agent
    only), off unless Settings → Tools → Matching (`settings.tools.match.mode`) is `recommend` or `matching`, or
    an MCP server has its own `matching` 'recommend' or 'matching' (`matchesAny`). `tools/match.ts`:
    - `matchGroups`: the filterable groups (`web`, `history`, `bookmarks`, `custom`, `custom:<section>`,
      `mcp:<server>`; not a server on demand, `onDemandServers`; `custom_tools.*` and `actions.*` left out). Each
      group's mode is its server's own `matching` ('always' = all, 'recommend', 'matching'), else the setting's
      (`groupModes`); groups at 'all' are not matched.
    - `scoreGroups` matches each tool (the group's label and the tool's name weighing 2, its description 1; BM25
      with `unseen` 0.5: the typed words no tool has count half against the match), and a group goes by its best
      tool, the matching tools kept best first (`ToolMatch.groups[].tools`, the recommendation's order). By
      meaning (`tools/match-meaning.ts`): Memory's semantic target, the message's vector (shared with memory's
      through `embedQuery` and the turn object) against each tool's, a group by its closest tool,
      judged relative to all the tools' scores for the message (`meaningCuts`: the best must stand
      `MEANING_STAND_OUT` 2 spreads above their mean; then a group passes within `MEANING_LEVELS[tools.match.level]`
      spreads of it for 'matching' (offer-more 1.5, the default; balanced 1; hold-more 0.5; an earlier build's
      `meaningLevel` strict read as hold-more), `MEANING_RECOMMEND_WITHIN` 0.5 for 'recommend'; a server's own
      `about` (`serverAbouts`) is matched as one more tool of its group (`aboutName`, never offered); nothing stands out: 'matching'
      groups `unsure`, offered, nothing recommended; fewer than `MEANING_MIN_TOOLS` 5 tools indexed: by words);
      within 2 s, else by words with a notice. The
      tools' vectors (`tools/tool-index.ts`: tool name as words without its server's name, and description, masked, after the
      document prefix; by tool name in their own database `browser-agent-tool-vectors`) are never asked for on a
      message's path: `syncToolIndex` embeds the missing ones in batches of 32, started by the run once the
      message is matched (`indexToolsLater`, from `toIndex`) and by Settings → Tools → Matching, which counts
      them and shows `toolIndexStatus` (storage.local).
    - `decideToolMatch` decides against `reference`, every group offered (`matchGroups(…, { every: true })`, the
      browser's too; meaning indexes them all): by words (`scoreGroups` drops `COMMON` words of the message first)
      with `wordCuts` (the best tool must reach `threshold`, 40 by default; then a group within `WORDS_WITHIN` 0.5 of
      it for 'matching', 0.85 for 'recommend'; match and cut compared as whole percents, `reachesWords`), or by meaning (`meaningCuts`). Neither points at any tool (`unsure`):
      'matching' groups are offered (outcome `unsure`), nothing is recommended; `wordsOnly` when no meaning was used. The decision (`ToolMatch`,
      event `tool-match`, kept as `Message.toolMatch`) says per group its `mode` and `matched`, `used` (one of its
      tools was called, `usedGroups`), `earlier` (stays from an earlier message; not after `unsure`), `loaded`,
      `mentioned`, `unsure`, `held` or `unmatched`, plus the groups always offered: what
      the chat shows as a 🔧 pill under the message (`ui/chat/AttachedChips` `toolMatchGroups`), and the Layers
      view as the phase *Matching the tools* (`toolMatchNote`, under *Preparing your message*,
      only when something is matched).
    - The 'recommend' groups that matched go in `tools.recommended` (source `tool-match:`); the `held` ones go to
      `withOnDemand` as groups on demand (`tools.load_builtin` lines, or the server's), and the previews rebuild
      them from the kept decision (`heldFor`).

Sources (what each part is, used by dedupe and the Layers view): `core/sources.ts`, labels in
`context/pieces.ts`. Auto-inject switches and per-conversation skip: `context/auto-inject.ts`.


#### Memory matched by meaning (Settings → Memory → Semantic search)

Settings → Memory → **Semantic search** (`memory.semantic`, `memory/semantic.ts`), off by default, with an
embeddings model of a configured provider (`POST {baseURL}/embeddings`, `providers/embeddings.ts`: its key
and extra headers, never `extraBody`). An item passes if its words reach Auto-attach's match needed **or**
its meaning reaches its own (cosine, `threshold`, 55 by default): for auto-attach and for the site items of
`autoInject.memorySiteMatch`. BM25's match and cosine are never compared: their order is fused
(`fuseRanks`). Between the model's steps, memory goes by words only, and the model's `memory__search` and
the lists' search boxes too.

- **The message** (`memory/query-meaning.ts`): one vector per message, before `siteContextItems`, which gets
  the scores as data. Nothing is asked with no item that could pass or none indexed, or for a conversation
  that left it out: the kind `memoryMeaning` in `skip`, from the ✨ menu, kept by conversation in
  `storage.local` (`context/meaning-off.ts`), which the worker reads itself. At most 2 seconds; on a timeout,
  an error, no access to the host (never asked for here) or other dimensions, the message goes by words
  with a notice. The model is not told.
- **The index** (`memory/indexer.ts`, `background/memory-index.ts`): off the message path, in batches of 32,
  saved each, while the switch is on; at the worker's start and when the items, the settings or the
  word blacklist change. Pinned items need none and are never sent. A vector stands for its item only with
  the same provider, model, dimensions (those Test found) and hash of the text sent.
- **Storage** (`memory/vector-db.ts`): a database of its own, `browser-agent-vectors`. The secrets' one stays
  at version 1, or older builds sharing the profile could not open it. Not in any export.
- **Word blacklist**: while on and with terms, everything sent to the embeddings provider is masked, whatever
  its per-provider or per-URL conditions, as an indexed item has no conversation for them to apply to. The
  hash is of the masked text, so changing the terms embeds again.

### 1.5 Between steps (`context/step-attach.ts`)
Memory (`memory.step_block`) and bookmarks (`bookmark.step_note`) matched by what the model wrote
before calling tools, each once per conversation; appended to the last tool result's content and
recorded in `attached` (`agent-loop.ts`). Off unless the auto-attach and its "steps" box are on.
After them, the latest plan (`plan.reminder`, `context/plan-reminder.ts`) when it has steps not done
and the model's tool calls (`user.plan`'s left out) since it last showed it pass a multiple of the
`planReminder` limit (8), or those of the whole turn one of `planReminderAlways` (20, 0: off), which
comes even when the model keeps updating it. With no plan shown in the turn and `user.plan` offered, a request for one
(`plan.start_reminder`) after `PLAN_START_REMINDER_ROUNDS` (3) rounds, once a turn. A plan the user
took away (marked on its call, `dismissed`, never sent) gets no reminder.

### 1.6 Tool results (`core/tool-exec.ts` `serialize`)
Text/JSON cut to `toolResult` = 8000 chars, the whole kept for `tools.read_more`
(`core/kept-results.ts`: in the background's memory, the last 20 per conversation, lost when the
service worker restarts; the cut note `result.cut_read_more` gives its id). Custom tools' HTTP and
script answers are cut and kept the same way. `tools.read_more` (`tools/read-more.ts`, offered to
every agent with tools, `background/run-setup.ts`) gives the next part in `result.read_more`, or
`result.read_more_gone`. Images → `result.screenshot`
plus the image; the provider sends tool images in an extra user message (`providers/wire.ts`).
Write actions return the page after the action and its element list as `elements`
(`tools/browser/write-tools.ts`) so in-run can drop old lists. Screenshots shrunk to
`screenshotSize` (`tools/browser/read-tools.ts`); `get_page_text` defaults to `pageText` and
may ask up to `pageTextMax` (`read-tools.ts`). It and `web.read` take `from` to read on after a
cut, which their note (`result.cut_from`) gives.

### 1.7 Sub-agents (`background/sub-agent.ts`)
Same `prepareAgent` + `loopOptions` (so in-run shortening and dedupe apply), one message
(`agent.task`, its `{task}` the brief: `brief.*`, agents/brief), no page block, no step attach. The caller gets
only `result.agent_answer`, then `result.agent_tools` (its tool calls, counted); the
whole run is kept as `trace` (shown to the user, not sent). No compaction (see gaps).

## 2. Size caps
- `core/limits.ts` `LIMIT_DEFS`: label, default, unit, what happens past it, `range` = editable
  in Settings → Limits. `limit(id)` (`limits.ts`) uses `setLimitOverrides` from
  `applyModelSettings` (`context/model-settings.ts`, also texts and dedupe).
- `core/clip.ts`: `clip`, from a `from` (no imports: the page script uses it). `core/truncate.ts`: `withMarker` (adds `cutNote` for the views + `result.truncated` or
  `result.snapshot_truncated`), `truncate`, `withReadOn`/`readOn` (`result.cut_from`), `withReadMore` (`result.cut_read_more`),
  `keepLatest` (summary transcript keeps the newest part).
- Context-saving limits with the ctx chip (`ui/LimitsSettings.tsx`): `screenshotSize` 1568 px,
  `pageTextMax` 50000, `summaryText` 60000 (`background/summarize.ts`), `pinnedMemory` 8000,
  `siteMemoryItems` 20.
- `fitBlocks` (`context/budget.ts`): by priority; the first that does not fit is cut if ≥150
  tokens remain, else left out with `page.dropped`.

## 3. What is sent vs. what is stored: `modelView` (`context/compaction.ts`)
Order inside a run: `shortenRun` (in-run) → `compactedView` → `dedupeContext` → system note /
`user.stopped` (`user.interrupted` when the turn was stopped by a message sent at once). The stored
history and the chat always keep everything whole.

### 3.1 Compaction (`context/compaction.ts`, panel `entrypoints/sidepanel/useCompaction.ts`; all of it in [compaction.md](compaction.md))
- Defaults `compaction.ts`: auto, threshold 80 %, keepTurns 4, summarize, maxWords 400,
  **defaultWindow 72000** (used when the model's window is unknown; 0 = no auto).
- Stored as `Message.compaction` on the first message kept whole. `compactedView`
  (`compaction.ts`): before it, messages trimmed (`trimMessages`, `compaction.ts`: page
  parts, tool results over `KEEP_CHARS` = 400, screenshots, your images; and, on compactions that
  have them (`replies`, `toolArgs`, `attached`): the model's replies over 1400 chars cut to their
  first 1000, call arguments over 400 chars as `{"left_out": note}`, `skill`/`memory` parts over 400
  (sent again on `seenWhole`) → `compaction.trimmed`; your text and step-attached text kept; the
  summary's transcript keeps replies whole) or replaced by the summary (`compaction.summary` on the kept message).
  `inner`: trims inside the latest turn except the last `KEEP_LAST` = 4 messages.
- `compactionStep` (`compaction.ts`): aims at half the threshold; tries trim, then summarize,
  keeping fewer turns, then inner. `fixed` = reported/estimated use minus messages (system + tools).
- When: only in the panel, before sending (`useCompaction.ts`) or "Compact now" in the meter.
  Summary by `background/summarize.ts` with `compaction.summary_request`.

### 3.2 During a turn (`context/in-run.ts`)
Defaults `in-run.ts`: enabled, keepResults 2, minChars 400, lastScreenshot, lastElements
(ranges `in-run.ts`). Only tool results after your latest message: all but the latest
`keepResults` (and those of the latest step, and the latest `skills.load` and `skills.read_reference`) longer than `minChars` → `run.left_out`; older screenshots and older after-action
element lists → `run.left_out`. Results of calls not safe to repeat (`repeatableIn`: effect not
`read`, or source `agent`/`user`) stay whole, but at squeeze 2, where they go as `run.left_out_kept`.
Step-attached text kept. Settings `compaction.inRun`.

**Near the window** (`squeezeRun`, `agent-loop.ts` `FULL` = 0.9): the run's window is the panel's
(`run.contextWindow`, the meter's or Settings → Compaction's default) for the chat, and for a
sub-agent on another model `context/window.ts` `runWindow` (set for the model, learned, the
provider's, else the default). A request estimated over 90 % of it goes with squeeze 1 (only the
latest result whole, latest screenshot/elements; also with in-run off), then squeeze 2 (the turns
before also trimmed as compaction trims them). A server's "too long" before the answer started
(`isContextOverflow`) sends it once more with squeeze 2, as every later request of the run, and the
window it names is learned (`onOverflow`, `learnContextWindow`); a refusal at squeeze 2 errors. The chat
gets a notice (`NEARLY_FULL` once per run, only when something was left out; `SENT_SHORTER`).

### 3.3 Don't resend (`context/dedupe.ts`)
Defaults `dedupe.ts`: page, siteValues, mentions, attachments. Runs on the compacted view, so only
a copy the model still sees whole counts (`seenWhole`). Page block, site values/template output and
`::site` mentions: same as the *last* one of their key → `context.unchanged`. Mentions (`#`, `b::`,
`/skill`), files, recordings and your images: same as any earlier whole one →
`context.already_attached` (an image becomes a text note). Settings `context.dedupe`; module state set by
`applyModelSettings`.

### 3.4 Settings UI
`ui/CompactionSettings.tsx` (Compaction, During a turn, Don't resend), `ui/LimitsSettings.tsx`.
The magenta chip: `ui/Chip.tsx` `CtxChip`, style `ui/style.css:54`, colours `--ctx-fg/--ctx-bg`
in `ui/tokens.css`. Every context-saving setting gets it.

### 3.5 A model caught in a loop (`core/repetition.ts`, `core/agent-loop.ts`)
While a call streams, every 64 characters the end of the text or reasoning is looked at: a fragment of
1–20 chars 50 times in a row over ≥ 400 chars, or one of 21–300 chars 8 times in a row (only
"primitive" fragments, never only whitespace), is a loop. The call is aborted, the part kept up to the
loop plus 3 repetitions (calls it began dropped), the chat gets "Reply cut: it kept repeating …", and
the turn ends. The message gets `cut`; your next message goes with `user.repetition_cut` first (as
`user.stopped`). A sub-agent's answer says "(Its reply was cut: …)". No retry, no settings.

## 4. Token estimates and the meter
- `context/budget.ts` `estimateTokens`/`tokenWeight`, by script: Latin, numbers, symbols and code 4
  chars a token; Chinese, Japanese, Korean 1 a char; Cyrillic, Greek, Arabic, Hebrew, Indian scripts,
  Thai 2 chars a token. `imageTokens`: width × height / 750 within 85–1600, the size read from the
  PNG/JPEG header (`core/image.ts` `imageSize`); unreadable: `IMAGE_TOKENS` = 1500. `partTokens`,
  `messagesTokens`. Reasoning counts 0 (sent back only within a turn: the server's reported input counts it). Tool specs: `toolsChars` / 4.
- `context/token-ratio.ts`: per model, reported ÷ estimated input of each call the server reports
  (requests ≥ 200 tokens), moved 30 % toward each new one, within ×0.5–×2.5, in storage.local
  `tokenRatios`. Applied (`corrected`) to compaction's numbers (`compactionStep`, panel
  `useCompaction`), the agent loop's 90 % check (`tokenRatio`, main and sub-agents) and shown in the
  meter ("Estimates for this model corrected ×…").
- `context/usage.ts`: `estimateRequest` (breakdown system/tools/conversation/page/skills/results),
  `estimateSources` (by origin mark), `toolsChars` = `JSON.stringify(specs)` cached per list,
  `measureCall`, `callTokens` (server-reported when given, else estimate), `contextUsed` = input + output.
- `context/window.ts`: window from model setting > learned from a "too long" error > server >
  provider setting > model max (`pickContextWindow`, `:45`).
- Meter: `entrypoints/sidepanel/ContextMeter.tsx` (last call's used / window, warns ≥ 80 %, cuts
  of the turn, set window, Compact now with `useCompaction.wouldFree`, by-origin table folded). Its
  view model is `entrypoints/sidepanel/context-parts.ts`: `contextParts` (fixed = system + tools,
  growing = the rest, delta against `SessionUsage.previous` when both were measured), `sentToolGroups`
  (`CallUsage.toolNames` matched against the tab's catalog, weighed by `ui/request-parts`
  `toolGroupSizes`), `growth` (first request, last delta, none across a compaction).
  `SessionUsage.timeline` (`agent-state.ts`, rebuilt from saved metas by `timelineOf`) holds each
  call's input and the compactions; `reported.cached` / `MessageMeta.cached` come from
  `usage.prompt_tokens_details.cached_tokens` (`providers/openai-compat.ts`).

## 5. Model texts involved (TEXT_DEFS, `src/core/texts/`)
`defs-user.ts`: `page.block/meta/selection/elements/dropped/elements_replaced`,
`compaction.summary`, `compaction.trimmed`, `run.left_out`, `run.left_out_kept`, `context.unchanged`,
`context.already_attached`, `compaction.summary_request`,
`memory.site_block/site_index_block/auto_block/step_block`, `user.stopped`, `user.interrupted`, `recording.block`,
`file.block`, `pdf.page/scanned/not_kept`, `template.data`, `skill.site_block`, `skill.reminder`,
`skill.values`, `context.no_page*`, `agent.task`, `brief.*`.
`defs-system.ts`: `system.*`, `system.compaction`.
`defs-replies.ts`: `result.truncated`, `result.snapshot_truncated`, `result.screenshot`,
`history.auto_note`, `bookmark.auto_note/step_note`, `history.mention_note`, `result.agent_answer`.

## 6. Known gaps
1. **Tool definitions and the skills catalog go on every call.** The 58 fixed tools are ~56k chars
   (~14k tokens). The 12 that create things (`CREATE_TOOLS`, ~27.5k chars) go on demand for Default
   and Browser asked by an agent (`tools/load.ts`, Settings → Tools, on by default): `tools.load`
   instead, loaded once per conversation (from the history). The page's own tools (WebMCP) go last
   (`background/tool-catalog.ts`), so navigating breaks only the tail. `skillsInstructions` lists
   every general skill in the system prompt but, for Browser with that group on demand, the skills
   that guide it (`heldSkills`); `templates.run` goes without its draft views until then. An MCP server set "On demand"
   (Settings → MCP servers, off by default) goes as a `mcp:<server>` line of `tools.load` for every
   agent, its tools offered once loaded.
2. **No summary inside a run.** Compaction (with its summary) only runs in the panel before a message.
   Inside a run (also a sub-agent's) requests near the window are shortened more and a "too long"
   is sent once more shortened (§3.2); what is still too long after that errors (and the window is
   learned). The fixed part (system prompt, tools) is never shortened.
3. ~~Estimates: 4 chars/token, 1500 tokens/image~~: by script and image size, and corrected per
   model from what its server reports (§4). Still no real tokenizer; with a server that never reports
   usage, the estimates go uncorrected. The page budget is in estimated tokens (not corrected).
4. ~~Per-message items never deduplicated~~: memory blocks, memory changes, history/bookmark auto
   items and site skills already go once per conversation (judged on `seenWhole`). `::site` mentions
   (with `siteValues`), files, recordings and your images (`attachments`) now go as a note when the
   model still sees the same copy (`context/dedupe.ts`). Still every turn, on purpose (each says
   something of that message, ~100 chars): tool mention notes, `skill.reminder`, `context.no_page`.
5. ~~"Once per conversation" judged on the stored history~~ — fixed:
   judged on `seenWhole` (see 1.4).
6. ~~Compaction trims only page-kind parts, tool results and images~~: it also cuts long replies,
   long call arguments and attached site skills/memory (§3.1). Your typed text is never trimmed.
7. **Defaults lowered** (`toolResult` 8000 chars, `pageText` 7000, `pageBudget` 1500 tokens,
   keepResults 2; were 12000, 10000, 2000 and 3): up to ~16000 chars of results go whole in one step.
8. ~~System prompt rebuilt per run~~: memory is now kept per conversation (see 1.3). Other parts
   (skills catalog, MCP, settings) still change it when you change them.
