# FAQ

**Which models work?**
Any served through an OpenAI-compatible `/chat/completions` endpoint. Acting on pages works best with models that
are good at tool calling; small local models can answer about a page but may struggle with multi-step actions.

**Is it free? Is there an account?**
The extension is free and open source (Apache-2.0) and has no account. You pay your model provider, if any.

**Does it send my browsing to anyone?**
Only to the providers, servers and sites you configure, and only what goes with your messages and the tools the
model runs. No telemetry. The downloadable version also asks GitHub, once per browser session, whether a newer
release is out, with nothing of yours in the request (Settings → About turns it off). See [Privacy and security](privacy-and-security.md).

**The chat says it cannot read the page.**
Allow the site when the chat asks (or in **Settings → Website access**). Browser pages (`chrome://`), the Chrome
Web Store and `file:` pages cannot be read by any extension.

**The model keeps asking before every click.**
That is the default policy, *Ask before acting*. On a site you trust, choose **Allow on *site* → Always**, or set
the policy in the selector under the conversation.

**The model does not see something on the page.**
The page block holds only what is visible and interactive, within its budget. Scroll to it, select the text you
mean, or ask the model to read the whole page (`browser.read_page`, `browser.get_page_text`). For a site you use
often, a [site template](site-templates.md) extracts exactly what matters.

**A click does nothing on some site.**
Some pages ignore synthetic events. Turn on **Settings → Chromium DevTools** to use real input.

**Test connection fails.**
See [Providers → Troubleshooting](providers.md#troubleshooting). For Ollama, start it with
`OLLAMA_ORIGINS='chrome-extension://*'`.

**I lost my settings after updating.**
Updating means replacing the folder's files and clicking ↻ on the extension's card. Removing the extension
deletes its data; load the new version over the same extension instead.

**The downloadable version has a "key" in its manifest. Is a secret of someone's inside the download?**
No. That key is public: it only fixes the extension's id, so that an update, or the same folder moved elsewhere,
is still the same extension and keeps your settings. The Chrome Web Store version has none, as the store gives it
its id, which is why its settings are apart
([the versions](getting-started.md#the-downloadable-version)). No published version carries an API key: yours
is typed in Settings and stays in your browser. Only a build you make yourself with a key in the environment
has one inside ([personal builds](providers.md#a-provider-from-the-environment-personal-builds)): do not share
that one.

**How do I move my setup to another browser, or keep a copy?**
[Settings → Export and import](settings.md#export-and-import): one file with the parts you choose, never with
keys or other secrets. In the other browser, import it there and pick what comes in; then add the providers' keys.

**Does it work in Firefox, Edge or Brave?**
Firefox: only as a trial build, without the DevTools engine, Speak, a tab's audio, the floating chat, a panel for each
tab or the sources of custom tools, and never in private windows
([what each version has](settings.md#what-each-version-has)). It is built and tested for Chrome and used in Vivaldi;
other Chromium browsers with side panels may work but are not tested.

**Some setting shows an "unavailable" mark. Why?**
Your version, or your browser, does not have that feature. Why, and a link to the docs page about it or to the
downloadable version (which has everything), is in the section the mark leads to and in **Settings → About**; in
the menu the mark's tooltip says it too, and on a greyed row clicking the mark opens it under the row. The Chrome Web
Store version leaves out the DevTools engine. Your settings move to the other version with
[Export and import](settings.md#export-and-import).

**Can I use it at work with sensitive data?**
Use a provider your organization approves (a self-hosted model or a gateway), the
[word blacklist](privacy-and-security.md#word-blacklist) to mask names, *Read only* policies where the model only
needs to read, and agents limited to the sites they need.

**Something else does not work.**
See [Troubleshooting](troubleshooting.md). For step-by-step guides (forms, comparing tabs, web research, tables…),
see the [how-to guides](../howto/README.md).
