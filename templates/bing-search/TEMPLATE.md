---
name: bing-search
description: The web results of a Bing search, one line each, for web.search
matches:
  - "*://www.bing.com/*"
---
<!-- view: results | paths: /search* | replace_page: true -->
{%- assign results = page | select: "li.b_algo" %}
{%- for r in results %}
- [{{ r | one: "h2 a" }}]({{ r | one: "h2 a" | attr: "href" }}) · {{ r | one: "cite" }} — {{ r | one: ".b_caption p" }}
{%- endfor %}
