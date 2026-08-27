import { NextResponse } from "next/server";

import { buildDocsCorpusIndex } from "@/lib/docs-index";
import { selectSections } from "@/lib/docs-retrieval";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Instructions for answering over documentation (#990).
 *
 * Sent explicitly rather than reusing the pipeline's stored
 * `ask_page_system` prompt, which mandates transcript-style
 * `[Episode Title, MM:SS]` citations. Documentation has neither, and the
 * model dutifully appended "[Context, N/A]" to every claim. Citations are
 * rendered as links from the `sources` event, so the model is told to leave
 * them out of the prose entirely.
 */
const DOCS_SYSTEM_PROMPT = `You are answering questions about Podlog, a self-hosted podcast transcription and search app, using excerpts from its own documentation.

RULES:
- Answer ONLY from the provided documentation excerpts.
- If the excerpts do not cover the question, say so plainly rather than guessing.
- Do NOT add inline citations, source markers, or bracketed references of any kind. The interface shows the sources separately.
- Format with Markdown: **bold** for emphasis, bullet lists for multiple points.
- Be concise and direct.`;

/**
 * POST /api/docs/ask — Ask over Podlog's own documentation (#990).
 *
 * Retrieval happens here because this is the only container with the docs
 * mounted; generation happens in the pipeline, which owns provider routing
 * and SSE streaming. The selected passages travel in the request body as
 * `context`, which /api/ask answers over instead of retrieving transcript
 * chunks. See docs/superpowers/specs/2026-08-26-docs-ask-design.md (D3).
 */
export async function POST(req: Request) {
  let body: { question?: string; model?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const index = await buildDocsCorpusIndex();
  const sections = selectSections(question, index);

  if (sections.length === 0) {
    // Better an honest miss than a confident answer from nothing. Returned as
    // a well-formed SSE stream so the client handles it on the same path as
    // any other error frame rather than needing a second failure mode.
    const sse =
      `event: error\ndata: ${JSON.stringify({
        message: "No documentation matched your question.",
      })}\n\n` + `event: done\ndata: {}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const resp = await fetch(`${PIPELINE_API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      system_prompt: DOCS_SYSTEM_PROMPT,
      model: body.model,
      history: body.history,
      context: sections.map((s) => ({
        title: s.sectionTitle || s.docTitle,
        source: s.source,
        slug: s.docSlug,
        anchor: s.sectionId || null,
        repo_path: s.repoPath,
        text: s.content,
      })),
    }),
  });

  if (!resp.ok || !resp.body) {
    return NextResponse.json(
      { error: `Pipeline returned ${resp.status}` },
      { status: resp.status || 502 },
    );
  }

  return new Response(resp.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
