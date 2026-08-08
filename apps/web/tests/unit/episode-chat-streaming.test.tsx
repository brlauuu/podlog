/**
 * SSE streaming path for EpisodeChat — the send() reader loop (sources /
 * token / error / done events) plus conversation export. The base
 * episode-chat.test.tsx deliberately stops at `!resp.ok`; this file wires a
 * fake ReadableStream reader so the streaming branches are exercised.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// Radix DropdownMenu relies on pointer APIs jsdom lacks; render its pieces
// inline so the export menu items are directly clickable.
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import EpisodeChat from "@/components/EpisodeChat";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";

function wrap(ui: React.ReactNode) {
  return <AudioPlayerProvider>{ui}</AudioPlayerProvider>;
}

const baseProps = {
  episodeId: "ep-1",
  episodeTitle: "Test Episode",
  feedTitle: "Test Feed",
  episodeDescription: null,
};

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function streamResponse(sse: string) {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(sse)];
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined },
      }),
    },
  };
}

function mockAsk(sse: string) {
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/notifications/settings") {
      return Promise.resolve({ ok: true, json: async () => ({ rag_local_model: "qwen2.5:3b" }) });
    }
    if (url === "/api/pipeline/ask") {
      return Promise.resolve(streamResponse(sse));
    }
    return undefined;
  });
}

// Shape must match lib/citations.ts `Source` — MessageBubble reads chunk_id,
// timestamp, speaker_label and text when it renders the sources list.
const SOURCE = {
  chunk_id: 1,
  episode_id: "ep-1",
  episode_title: "Test Episode",
  speaker_label: "SPEAKER_00",
  start_time: 12.5,
  end_time: 30,
  timestamp: "00:12",
  text: "some transcript context",
  similarity: 0.9,
};

const HAPPY_SSE =
  `event: sources\ndata: ${JSON.stringify([SOURCE])}\n\n` +
  'event: token\ndata: {"content":"Hello"}\n\n' +
  'event: token\ndata: {"content":" world"}\n\n' +
  "event: done\ndata: {}\n\n";

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  Element.prototype.scrollIntoView = jest.fn();
});

async function ask(question = "hi?") {
  const user = userEvent.setup();
  render(wrap(<EpisodeChat {...baseProps} />));
  await user.click(screen.getByRole("button", { name: /ask about this episode/i }));
  await user.type(screen.getByPlaceholderText(/ask about this episode\.\.\./i), question);
  await user.keyboard("{Enter}");
  return user;
}

describe("EpisodeChat — SSE streaming", () => {
  it("renders the streamed assistant reply from token events", async () => {
    mockAsk(HAPPY_SSE);

    await ask();

    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("surfaces an error event from the stream", async () => {
    mockAsk('event: error\ndata: {"message":"stream boom"}\n\n' + "event: done\ndata: {}\n\n");

    await ask();

    expect(await screen.findByText(/stream boom/i)).toBeInTheDocument();
  });

  it("exports the conversation as markdown and text after a completed exchange", async () => {
    mockAsk(HAPPY_SSE);
    const createObjectURL = jest.fn(() => "blob:mock");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    const user = await ask();
    await screen.findByText("Hello world");

    // A completed exchange reveals the Download menu (mocked inline).
    await user.click(screen.getByRole("button", { name: /markdown \(\.md\)/i }));
    await user.click(screen.getByRole("button", { name: /plain text \(\.txt\)/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(2);
  });
});
