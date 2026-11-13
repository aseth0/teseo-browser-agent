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
