# Security policy

Teseo reads web pages and acts in the browser on its user's behalf, so security reports are taken
seriously and handled first.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Include what an attacker can do, the steps or a page that shows it, and the version (Settings or
`manifest.json`). You will get an answer as soon as possible, and credit in the release notes if you wish.

## In scope

- A web page, a tool's answer or an MCP server making the model act **without the user's permission**: an action
  that skips its confirmation (a page answering for the user a card shown inside it included), runs on a site other
  than the one allowed, or escapes an agent's sites or tools.
- Secrets (API keys, header values, sign-ins, `{{secret:…}}` values) reaching a page, the model, a log or another
  site.
- Web pages detecting, reading or controlling the extension, its storage or its pages.
- Script tools escaping their sandbox, or an HTTP tool, a script or a tool source reaching a site other than
  its own, through a redirect too.

## Out of scope

- A model following injected text in a way the user then **approved** in a confirmation card, or on a site the user
  set to *Act without asking* (its plain `http://` pages off the user's machine still ask). That is a limit of current models; reports that improve the defenses are still
  welcome as issues.
- Builds made with `EXTERNAL_MODEL_API_KEY`, which embed the key by design and must not be shared.
- Access by someone who already controls the user's browser profile or machine.

## Supported versions

Only the latest release receives fixes.
