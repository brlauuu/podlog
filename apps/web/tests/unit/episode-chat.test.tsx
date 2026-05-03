/**
 * Tests for EpisodeChat — floating trigger, open panel, model selection,
 * submit + failure, and MessageBubble rendering with citations.
 *
 * Full SSE stream parsing is covered by the proxy-route tests; here we
 * stop at the first branch (`!resp.ok`) so we don't have to construct a
 * ReadableStream in jsdom.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import EpisodeChat from "@/components/EpisodeChat";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";

function wrap(ui: React.ReactNode) {
  return <AudioPlayerProvider>{ui}</AudioPlayerProvider>;
}

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  // jsdom doesn't implement scrollIntoView; stub it.
  Element.prototype.scrollIntoView = jest.fn();
  // Default: settings endpoint returns rag_local_model so the model-hydration
  // useEffect doesn't blow up when localStorage is empty (#637).
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/notifications/settings") {
      return Promise.resolve({ ok: true, json: async () => ({ rag_local_model: "qwen2.5:3b" }) });
    }
    return undefined;
  });
});

const baseProps = {
  episodeId: "ep-1",
  episodeTitle: "Test Episode",
  feedTitle: "Test Feed",
  episodeDescription: null,
};

describe("EpisodeChat — trigger state", () => {
  it("renders as a floating Ask button when closed", () => {
    render(wrap(<EpisodeChat {...baseProps} />));
    expect(
      screen.getByRole("button", { name: /ask about this episode/i })
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask about this episode\.\.\./i)).not.toBeInTheDocument();
  });

  it("opens the chat panel when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );
    expect(
      screen.getByPlaceholderText(/ask about this episode\.\.\./i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ask a question about this episode\./i)).toBeInTheDocument();
  });

  it("minimizes the chat panel back to the trigger via the X button", async () => {
    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));
    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );
    await user.click(screen.getByRole("button", { name: /minimize chat/i }));
    expect(
      screen.queryByPlaceholderText(/ask about this episode\.\.\./i)
    ).not.toBeInTheDocument();
  });
});

describe("EpisodeChat — model selector", () => {
  it("hydrates the model from localStorage when a valid value is stored", async () => {
    localStorage.setItem("podlog-ask-model", "phi3:mini");
    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );

    const select = screen.getByLabelText(/^model:/i) as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe("phi3:mini");
    });
  });

  it("persists model changes back to localStorage", async () => {
    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );

    const select = screen.getByLabelText(/^model:/i) as HTMLSelectElement;
    await user.selectOptions(select, "gemma4:e4b");

    expect(localStorage.getItem("podlog-ask-model")).toBe("gemma4:e4b");
  });
});

describe("EpisodeChat — handleSubmit", () => {
  it("ignores empty / whitespace-only input", async () => {
    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );

    // Submit button is disabled with empty input.
    const submitBtn = screen.getByRole("button", { name: "" });
    expect(submitBtn).toBeDisabled();
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("pipeline/ask"),
      expect.anything(),
    );
  });

  it("shows an error message when the pipeline response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, body: null });

    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );
    await user.type(
      screen.getByPlaceholderText(/ask about this episode\.\.\./i),
      "what was discussed?"
    );
    // Submit by pressing Enter.
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to connect to the pipeline API/i)
      ).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/pipeline/ask",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows a connection-failed message when fetch throws a non-abort error", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );
    await user.type(
      screen.getByPlaceholderText(/ask about this episode\.\.\./i),
      "why?"
    );
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.getByText(/Connection failed\. Is the pipeline running\?/i)
      ).toBeInTheDocument();
    });
  });

  it("silently returns on AbortError without surfacing an error", async () => {
    mockFetch.mockImplementation(() => {
      const e = new Error("aborted");
      (e as Error & { name: string }).name = "AbortError";
      // jsdom provides DOMException; fall back to a shaped object otherwise.
      const abortErr =
        typeof DOMException !== "undefined"
          ? new DOMException("aborted", "AbortError")
          : e;
      return Promise.reject(abortErr);
    });

    const user = userEvent.setup();
    render(wrap(<EpisodeChat {...baseProps} />));

    await user.click(
      screen.getByRole("button", { name: /ask about this episode/i })
    );
    await user.type(
      screen.getByPlaceholderText(/ask about this episode\.\.\./i),
      "why?"
    );
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    // No error banner should appear.
    expect(
      screen.queryByText(/Connection failed/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to connect to the pipeline API/i)
    ).not.toBeInTheDocument();
  });
});
