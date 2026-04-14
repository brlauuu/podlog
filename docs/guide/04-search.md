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

## Filtering by Speaker

The **Speaker** filter is populated from **user-confirmed speaker names** only (not raw `SPEAKER_00` labels, and not unconfirmed AI guesses).

How it works:

- The list is scoped to the currently selected **Source** filter.
- If no source is selected, speaker options come from all processed episodes.
- If one or more sources are selected, speaker options are limited to those sources.
- If manual uploads are included in Source, confirmed speakers from uploads are included too.

Why a name may not appear:

- The speaker has not been confirmed yet on any matching episode.
- The episode is not in `Done` status yet.
- The currently selected source filter excludes that episode.

Tip: if you confirm a speaker name on an episode page, return to `/search` and the name will become available in speaker filtering for relevant sources.

## Exporting Results

Click the download button to export search results:

- **Markdown** — full text with structure preserved
- **Plain text** — compact, no formatting
- **PDF** — print-friendly layout (opens print dialog)

## Bookmarkable URLs

Search URLs include the query as `?q=...`, so you can bookmark or share a search.

---

**Next:** [Episodes & Transcripts](05-episodes.md) | **Back:** [Managing Feeds](03-feeds.md) | **Home:** [Guide](README.md)
