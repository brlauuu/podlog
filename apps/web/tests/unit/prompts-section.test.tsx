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
});
