/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PromptsSection from "@/components/PromptsSection";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => body,
  } as Response);
}

const samplePrompts = {
  prompts: [
    {
      key: "ask_page_system",
      label: "Ask page — system prompt",
      description: "Used on /ask",
      value: "Default ask page",
      default: "Default ask page",
      is_overridden: false,
      updated_at: null,
    },
    {
      key: "ask_episode_system",
      label: "Episode Ask — system prompt",
      description: "Used in popup",
      value: "Custom episode prompt",
      default: "Default episode",
      is_overridden: true,
      updated_at: "2026-05-05T12:00:00Z",
    },
  ],
};

describe("<PromptsSection>", () => {
  it("renders one card per prompt and shows the modified badge for overridden entries", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));

    render(<PromptsSection />);

    await waitFor(() =>
      expect(
        screen.getByText("Ask page — system prompt"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("Episode Ask — system prompt"),
    ).toBeInTheDocument();
    expect(screen.getByText("modified")).toBeInTheDocument();
    // Reset disabled when not overridden, enabled when overridden.
    const resetButtons = screen.getAllByText("Reset to default");
    expect(resetButtons[0]).toBeDisabled();
    expect(resetButtons[1]).not.toBeDisabled();
  });

  it("PUTs the new value when Save is clicked", async () => {
    mockFetch
      .mockReturnValueOnce(jsonResponse(samplePrompts))
      .mockReturnValueOnce(jsonResponse({ ok: true }))
      .mockReturnValueOnce(jsonResponse(samplePrompts));

    render(<PromptsSection />);

    const textarea = (await screen.findByDisplayValue(
      "Default ask page",
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Edited text" } });

    const saveButtons = screen.getAllByText("Save");
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/prompts/ask_page_system",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ value: "Edited text" }),
        }),
      ),
    );
  });

  it("POSTs to /reset when Reset to default is clicked on an overridden prompt", async () => {
    mockFetch
      .mockReturnValueOnce(jsonResponse(samplePrompts))
      .mockReturnValueOnce(jsonResponse({ ok: true }))
      .mockReturnValueOnce(jsonResponse(samplePrompts));

    render(<PromptsSection />);

    await screen.findByText("modified");

    const resetButtons = screen.getAllByText("Reset to default");
    fireEvent.click(resetButtons[1]);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/prompts/ask_episode_system/reset",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("blocks save when the textarea is empty", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));

    render(<PromptsSection />);

    const textarea = (await screen.findByDisplayValue(
      "Default ask page",
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "   " } });

    const saveButtons = screen.getAllByText("Save");
    fireEvent.click(saveButtons[0]);

    await waitFor(() =>
      expect(screen.getByText("Prompt cannot be empty")).toBeInTheDocument(),
    );
    // Only the initial GET should have fired — no PUT.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Issue #893: a failed initial load used to leave the user on "Loading
  // prompts..." forever — the catch set a toast, but the `prompts === null`
  // early return rendered above the toast markup, so nothing was ever shown.
  it("shows an error with a retry button when the initial load throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    render(<PromptsSection />);

    expect(await screen.findByText(/failed to load prompts/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading prompts...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("treats a non-OK initial load as an error rather than an empty list", async () => {
    // resp.json() resolves fine here, so only an explicit resp.ok check
    // distinguishes this from "the server has no prompts configured".
    mockFetch.mockReturnValueOnce(jsonResponse({ detail: "boom" }, false));

    render(<PromptsSection />);

    expect(await screen.findByText(/failed to load prompts/i)).toBeInTheDocument();
  });

  it("recovers when retry succeeds after a failed initial load", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));

    render(<PromptsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Ask page — system prompt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    // The stale error toast is cleared too, so it can't contradict the list.
    expect(screen.queryByText(/failed to load prompts/i)).not.toBeInTheDocument();
  });

  it("keeps the loaded prompts on screen when a post-save reload fails", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));
    mockFetch.mockReturnValueOnce(jsonResponse({ ok: true })); // the PUT
    mockFetch.mockRejectedValueOnce(new Error("offline")); // the reload

    render(<PromptsSection />);
    await waitFor(() => screen.getByText("Ask page — system prompt"));

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "new value" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);

    // The write succeeded; a failed refresh must not blow the whole section
    // away and strand the user on an error screen.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Ask page — system prompt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows the API detail when a save fails", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));
    mockFetch.mockReturnValueOnce(jsonResponse({ detail: "too long" }, false));

    render(<PromptsSection />);
    await waitFor(() => screen.getByText("Ask page — system prompt"));

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "new value" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);

    expect(await screen.findByText("too long")).toBeInTheDocument();
  });

  it("toasts a network error when a save throws", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    render(<PromptsSection />);
    await waitFor(() => screen.getByText("Ask page — system prompt"));

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "new value" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("shows the API detail when a reset fails", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));
    mockFetch.mockReturnValueOnce(jsonResponse({ detail: "cannot reset" }, false));

    render(<PromptsSection />);
    await waitFor(() => screen.getByText("Episode Ask — system prompt"));

    // Second prompt is overridden → its Reset button is enabled.
    fireEvent.click(screen.getAllByRole("button", { name: /reset to default/i })[1]);

    expect(await screen.findByText("cannot reset")).toBeInTheDocument();
  });

  it("toasts a network error when a reset throws", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(samplePrompts));
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    render(<PromptsSection />);
    await waitFor(() => screen.getByText("Episode Ask — system prompt"));

    fireEvent.click(screen.getAllByRole("button", { name: /reset to default/i })[1]);

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });
});
