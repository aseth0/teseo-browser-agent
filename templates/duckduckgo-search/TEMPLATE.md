---
name: duckduckgo-search
description: The web results of a DuckDuckGo search (also its HTML version), one line each, for web.search
matches:
  - "*://duckduckgo.com/*"
  - "*://html.duckduckgo.com/*"
---
<!-- view: results | paths: /?*q=* | replace_page: true -->
{%- assign results = page | select: "article[data-testid='result']" %}
{%- for r in results %}
- [{{ r | one: "a[data-testid='result-title-a']" }}]({{ r | one: "a[data-testid='result-title-a']" | attr: "href" }}) — {{ r | one: "[data-result='snippet']" }}
{%- endfor %}

<!-- view: html-results | paths: /html* | replace_page: true -->
{%- assign results = page | select: ".result:not(.result--ad)" %}
{%- for r in results %}
- [{{ r | one: ".result__a" }}]({{ r | one: ".result__a" | attr: "href" }}) — {{ r | one: ".result__snippet" }}
{%- endfor %}
