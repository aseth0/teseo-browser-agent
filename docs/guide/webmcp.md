# WebMCP

Pages can offer their own tools to agents through **WebMCP** (`document.modelContext.registerTool`). When the page
you are on offers tools, the model sees them as `webmcp__<name>` for that page only.

- Calls to page tools are actions, judged by the site's policy.
- Everything the page provides (descriptions, parameters, results) is untrusted and size-limited.
- **Settings → Tools → Tools offered by websites (WebMCP)** holds the texts that wrap them.
