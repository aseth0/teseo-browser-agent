# Your prompt and About you

## Prompt preview

**Settings → Prompt preview** shows every fixed text the model receives, and what a request looks like with them.
Each text can be edited and restored to its default; texts that protect against prompt injection warn you before
you weaken them.

**Your system prompt**, at the top, is edited here: it starts the system message of every request, for every agent.

Three modes below it:

| Mode | Shows |
|---|---|
| **Templates** | Every fixed text, grouped by where it goes, each editable, with how it is sent. `{placeholders}` are filled on each turn. The tools' own texts are edited in **Settings → Tools**. |
| **Preview single call** | The request those texts produce, with example data |
| **Preview conversation** | How the requests grow over a few turns |

- **As** shows the previews as one of your agents sees them: its system message and only its tools.
- In Templates, **Show** filters the texts by when they are sent: **All**, **Always**, or **Only when** something
  calls for them.
- Once you change any text, **N modified** says how many, and **Restore all** puts every one back to its default,
  once you confirm.

Edit a text when the model keeps misreading an instruction, or to make it shorter for a small model. Use the
previews to check what your change costs and where it lands.

## About you

**Settings → About you** holds a text about you (name, role, language, preferences). It reaches the model only
where `{{about_user}}` appears: in your system prompt (every agent gets it) or in one agent's instructions.

The button next to `{{about_user}}` copies it, to paste where you want it. The count shows its length against the
limit, 4,000 characters by default (**Settings → Limits**); past it, the end is cut when sent. If no prompt uses
`{{about_user}}` yet, the page says so: the model does not get the text.

### Date & time

The **Date & time** tab of **Settings → About you** decides what the model is told of when you write. Each message
you send ends with a line the chat does not show, for example:

```
<message_time>Wednesday, 25 November 2026, 10:42 (Europe/Madrid, UTC+01:00)</message_time>
```

and the system message says once what the tag is. With it the model knows today's date and the time, and how
long ago your earlier messages were.

- Each part has its own switch: **Day of the week**, **Date**, **Time** (24-hour) and **Time zone** (its name and
  offset from UTC). All four are on by default. With all of them off, nothing is sent: no line, no tag.
- **In the time zone**: **Browser** (the default) uses the browser's zone, read each time a message goes; or
  pick one from the list to keep the date and time in that zone wherever you are.
- The tab shows the line as the model would get it now.
- The line is written once, when the message goes, and sent the same in every later request: the provider's
  prompt cache keeps working. A change here applies to the messages you send after it; earlier ones keep theirs.
  **Regenerate** sends a message again, so it gets the time it is sent again.
- A task one agent gives another (agents.ask) ends with the same line, with when it was asked. EmptyAgent gets
  neither. Compaction never drops the line of your latest messages.
- The two texts (the line and what the system message says of it) are edited in this tab or in Prompt preview.
