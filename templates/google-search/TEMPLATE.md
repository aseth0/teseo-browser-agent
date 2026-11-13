---
name: google-search
description: The web results of a Google search, one line each, for web.search
matches:
  - "*://www.google.com/*"
  - "*://www.google.es/*"
---
<!-- view: results | paths: /search* | replace_page: true -->
{%- assign results = page | select: "#search div.MjjYud:has(a h3)" %}
{%- for r in results %}
- [{{ r | one: "h3" }}]({{ r | one: "a:has(h3)" | attr: "href" }}) — {{ r | one: "div.VwiC3b" }}
{%- endfor %}
