# Skills

A **skill** is a set of instructions for a task you want done the same way every time: how to triage a ticket,
fill in a form, write a summary. Skills use the [Agent Skills](https://agentskills.io) format, a `SKILL.md`
file. Manage them in **Settings → Skills**: its figures count them (how many are on, built in, general and site),
and the chips over the list show only the **General**, **Site**, **Built-in** or **Yours**. Its limits, the
`/skill-name` mention and the texts the model gets are in the **Limits and texts** tab.

## General and site skills

| Kind | How it reaches the model |
|---|---|
| **General** | Listed by name and description in the system prompt. The model loads the whole skill when a request matches. |
| **Site** | Has URL patterns. On a matching page it is attached to your message: whole the first time in a conversation, then as a one-line reminder. |

Type `/skill-name` in a message to load a skill for that message.

## The format

```markdown
---
name: triage-ticket
description: Triages a support ticket: priority, component and the next step. Use it on a ticket page when asked to triage it.
matches:
  - "*://tracker.example.com/browse/*"
---
# Triage a ticket

1. Read the ticket's summary, description and comments.
2. Priority: High when …
3. Answer with the priority, the component and one next step.
```

- `name`: lowercase letters, digits and dashes, unique.
- `description`: what it does **and when to use it**; the model decides from it alone.
- `matches` (optional): Chrome match patterns. With it, the skill is a site skill.
- The body: Markdown instructions. A skill can also have **reference files** the model reads when it needs them.

### Values from the page

A site skill can pull values from the page into its instructions. They are sent apart, as untrusted page
content:

| Variable | Value |
|---|---|
| `{{url}}` | The page's URL |
| `{{page}}` | The page's main text as Markdown, cut at **Site skill value** ([Limits](limits.md)) |
| `{{selector:css}}` | The text of the first element matching a CSS selector |
| `{{selector:css?attr}}` | One of its attributes |
| `{{meta:name}}` | A `<meta>` tag's content |
| `{{schema:@Type:path}}` | A JSON-LD value, e.g. `{{schema:@Product:offers.price}}` |
| `{{items:container; field=css; …}}` | A list of records, one per container |

## Built-in skills

Built-in skills are read-only and switched on by default; switch each on or off in the list.

| Skill | |
|---|---|
| `summarize-page` | Summarizes the current page: key points, facts and figures, open questions |
| `fill-form` | Fills in a web form step by step, confirming before submitting |
| `create-skill` | Turns a task you want to repeat into a skill |
| `create-agent` | Creates or updates an agent with only what its task needs |
| `create-custom-tool` | Makes a custom tool from one you have, or one request to a web API |
| `create-script-tool` | Makes a script tool: several requests, or a sequence of tool calls |
| `create-template` | Creates or fixes a site template |
| `create-page-action` | Makes a page widget button |
| `manage-creations` | Reviews, changes or deletes what you made |

## Your own skills

Create them in the editor (name, description, URL patterns, instructions, reference files), ask the model to
make one (*"make this a skill"*, which you review before it is saved), or import them as JSON from a file, pasted,
or a URL ([Backups](settings.md#backups)). Imported skills arrive switched off; only your own skills are exported,
all of them or those you choose with **Select**.
