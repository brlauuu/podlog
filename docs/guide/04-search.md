# Search

Podlog provides hybrid search combining full-text keyword matching with semantic vector search.

## Full-Text Search

Type keywords into the search bar on the search page (`/search`). Podlog supports these operators:

| Operator | Example | Matches |
|---|---|---|
| Keywords | `climate change` | Segments containing both words |
| Exact phrase | `"carbon neutral"` | Exact phrase only |
| OR | `renewable OR solar` | Either term |
| Exclude | `emissions -diesel` | "emissions" but not "diesel" |
| Prefix | `econ*` | Words starting with "econ" (economics, economy, etc.) |

Operators can be combined: `"machine learning" OR deep -neural`.

## Semantic Search

In addition to keyword matching, Podlog uses vector embeddings (all-MiniLM-L6-v2 via pgvector) to find semantically similar content. This means:

- Searching `electric cars` can find segments about EVs, Tesla, or battery vehicles — even if those exact words aren't used
- Conceptual queries work better than with keywords alone
- Results are ranked by a combination of keyword relevance and semantic similarity

## View Modes

- **Grouped** (default): Results grouped by podcast, then by episode. Good for browsing.
- **Flat**: Individual segment results with pagination. Good for finding a specific quote.

Toggle between views using the buttons above the results.

## Filtering by Podcast

Use the feed filter dropdown to narrow results to a specific podcast. Useful when you remember which show discussed a topic but not which episode.

## Exporting Results

Click the download button to export search results:

- **Markdown** — full text with structure preserved
- **Plain text** — compact, no formatting
- **PDF** — print-friendly layout (opens print dialog)

## Bookmarkable URLs

Search URLs include the query as `?q=...`, so you can bookmark or share a search.

---

**Next:** [Episodes & Transcripts](05-episodes.md) | **Back:** [Managing Feeds](03-feeds.md) | **Home:** [Guide](README.md)
