# Compaction

Long conversations outgrow the model's context window. **Compaction** shortens what is *sent* to the model; the
chat and the saved conversation keep every turn whole. A line in the chat marks where a conversation was compacted,
and **Compact now** in the context meter runs it by hand.

By default it runs before a message once the context reaches **80%** of the window, aiming at half of that, one
step at a time:

1. **Trim** the earlier turns: their page blocks, long tool results, screenshots, long answers and arguments are
   left out (anything under 400 characters stays).
2. **Summarize** them, with the chat's model or another (at most 400 words by default).
3. Keep fewer turns whole, down to one.

During a long turn, what the model read earlier in the same turn is also shortened: only the latest tool results,
screenshot and page elements go whole. And what the model has already seen unchanged (the same page block, the
same skill) is sent as a short note pointing to the earlier copy.

Every threshold and option is in **Settings → Compaction** (below). For the details, see
[how context is built](../context.md) and [how compaction works](../compaction.md).

## Settings → Compaction

At the top, **Compact on its own** (on): before a message, once the context reaches the threshold. Off, only
**Compact now**, in the context meter, compacts. Under it, four figures: the threshold (80% of the window), the latest
turns kept whole (4), the summary and its model, and how many of the settings that save context are on. Every setting
in this section saves context. The defaults suit most models; change them when the context meter shows conversations
filling up too fast, or when the model loses track of what it did earlier. Then five tabs.

**When**, three cards:

| Card | Default | What it does |
|---|---|---|
| **Threshold** | 80% | 30 to 99. Lower it for a model that gets worse long before its window is full. |
| **Latest turns kept whole** | 4 | At most, 1 to 50. More keeps more of the recent work intact, at the cost of compacting sooner. |
| **Window if unknown** | 72,000 tokens | Used when the server publishes no window and none is set in the context meter. 0: no compacting on its own for such models. |

**Earlier turns**: the steps that compact the turns before the latest ones, in their order, until the context is
under half the threshold.

1. **Leave out**: a box for each part, all ticked: page blocks (the page, site templates, page values, mentions), tool
   results longer than a few lines, screenshots, long replies of the model (their first 1,000 characters kept), long
   arguments of tool calls, and the site skills and memory attached earlier (they go again with your next message
   while they still apply). Untick a part the model should keep seeing, for example the replies when you often refer
   back to an earlier answer.
2. **Summarize** (on), when leaving those out is not enough: the **Model that summarizes** (*The chat's*, or one of
   your providers with a **Model** id, for example a small, cheap one), **At most, words** (400 by default, 50 to
   3,000), and the text that asks for the summary, editable as in [Prompt preview](prompt.md#prompt-preview).
3. **Fewer turns kept whole**, down to one, and 4. **Trim the last turn**, all but its latest messages: nothing to set.

**During a turn**: in one turn the model may call tools many times, and each request carries everything before it.

- **Latest results sent whole** (2, 1 to 15), with its switch, **Leave out what the model read earlier in the turn**
  (on): an earlier result goes as a note saying the tool can be called again. The results of the latest step (calls
  made at once) and the latest skill and reference read always go whole.
- **Short ones always whole**: earlier results up to 400 characters (100 to 20,000) are never left out.
- **Only the latest screenshot** and **Only the latest page elements after an action (click, type, navigate…)**, both on.

**Don't resend**: what goes with your message the same as before goes as a short note pointing to the earlier copy,
while the model still sees that copy whole; once compaction trimmed or summarized it, the content goes whole again.
Four switches, all on: **The page block** when the page is the same; **Site templates and site skill values**;
**Mentions** (`#conversation`, `b::bookmark` and `/skill`); and **Attachments** (files, recordings and images you
attach again).

**Limits and texts**: **✂ Limits** sets **Conversation sent to be summarized** (60,000 characters), the same value as
in [Limits](limits.md); and the texts the model gets, as in Prompt preview.

The chat and the saved conversation keep everything whole, whatever these options leave out. A plan with steps left, unless you
closed it, still goes to the model after a compaction, whatever it summarizes or trims.
