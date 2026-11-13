---
name: summarize-page
description: Summarize the current web page with its key points, important facts and figures, and open questions. Use it when the user asks for a summary, a TL;DR or an overview of a page.
---
# Summarize a page

1. Get the main text with `browser__get_page_text`; the visible snapshot alone is not enough.
2. If the page is very long, paginated or cut off, say so and summarize what you read.
3. Answer with:
   - **TL;DR**: one or two sentences.
   - **Key points**: 3 to 7 bullets, most important first. Keep concrete facts, figures, dates and names.
   - **Open questions**: what the page leaves unclear or unsupported. Omit this section if there is nothing.
4. Answer in the language of the user's request.
5. Do not add facts that are not on the page. Quote short phrases when precision matters.
