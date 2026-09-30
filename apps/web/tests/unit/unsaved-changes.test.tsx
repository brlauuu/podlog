/**
 * The floating "Unsaved changes" bar on /settings and what feeds it (#1069).
 *
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  UnsavedChangesBar,
  UnsavedChangesContext,
  useLeaveWarning,
  type UnsavedEntry,
} from "@/components/UnsavedChanges";
import PromptsSection from "@/components/PromptsSection";
import BackupsSection from "@/components/BackupsSection";

function entry(over: Partial<UnsavedEntry> = {}): UnsavedEntry {
  return {
    label: "Notifications",
    saving: false,
    canSave: true,
    save: jest.fn(async () => {}),
    discard: jest.fn(),
    ...over,
  };
}

describe("<UnsavedChangesBar>", () => {
  it("renders nothing when there is nothing unsaved", () => {
    const { container } = render(<UnsavedChangesBar entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names every tab that has changes", () => {
    render(
      <UnsavedChangesBar
        entries={[entry(), entry({ label: "Inference" }), entry({ label: "Prompts" })]}
      />
    );
    expect(screen.getByRole("region", { name: /unsaved changes/i })).toHaveTextContent(
      "Unsaved changes in Notifications, Inference and Prompts"
    );
  });

  it("Save runs every entry's save, in order", async () => {
    const order: string[] = [];
    const a = entry({ save: jest.fn(async () => void order.push("a")) });
    const b = entry({ label: "Inference", save: jest.fn(async () => void order.push("b")) });
    render(<UnsavedChangesBar entries={[a, b]} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(order).toEqual(["a", "b"]));
  });

  it("Discard runs every entry's discard and saves nothing", async () => {
    const a = entry();
    const b = entry({ label: "Backups" });
    render(<UnsavedChangesBar entries={[a, b]} />);
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(a.discard).toHaveBeenCalledTimes(1);
    expect(b.discard).toHaveBeenCalledTimes(1);
    expect(a.save).not.toHaveBeenCalled();
  });

  it("refuses to save while any entry is invalid, and says which", () => {
    render(<UnsavedChangesBar entries={[entry(), entry({ label: "Backups", canSave: false })]} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("region")).toHaveTextContent(/fix backups before saving/i);
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  });

  it("locks both buttons while a save is running", () => {
    render(<UnsavedChangesBar entries={[entry({ saving: true })]} />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  });
});

function Leaver({ dirty }: { dirty: boolean }) {
  useLeaveWarning(dirty);
  return (
    <div>
      <a href="/queue">Queue</a>
      <a href="/settings#x">Same page</a>
      <a href="https://example.com/" target="_blank" rel="noreferrer">
        Elsewhere
      </a>
    </div>
  );
}

describe("useLeaveWarning", () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  beforeEach(() => {
    confirmSpy.mockReset();
    window.history.replaceState(null, "", "/settings");
  });

  function unload() {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }

  /**
   * Click a link; report whether the click was stopped before it reached the
   * link. The listener sits on the link itself, where next/link's handler
   * would be: a click stopped at the document never arrives here at all.
   */
  function follow(name: string) {
    const link = screen.getByText(name);
    let cancelled = true;
    const seen = (e: MouseEvent) => {
      cancelled = e.defaultPrevented;
      e.preventDefault(); // keep jsdom from trying to navigate
    };
    link.addEventListener("click", seen);
    fireEvent.click(link);
    link.removeEventListener("click", seen);
    return cancelled;
  }

  it("warns on reload or close only while something is unsaved", () => {
    const { rerender } = render(<Leaver dirty={false} />);
    expect(unload()).toBe(false);
    rerender(<Leaver dirty />);
    expect(unload()).toBe(true);
    rerender(<Leaver dirty={false} />);
    expect(unload()).toBe(false);
  });

  it("asks before following a link to another page, and stays if refused", () => {
    confirmSpy.mockReturnValue(false);
    render(<Leaver dirty />);
    expect(follow("Queue")).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("lets the link through when the user confirms", () => {
    confirmSpy.mockReturnValue(true);
    render(<Leaver dirty />);
    expect(follow("Queue")).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it("does not ask for same-page links, new-tab links, or when nothing is unsaved", () => {
    const { rerender } = render(<Leaver dirty />);
    expect(follow("Same page")).toBe(false);
    expect(follow("Elsewhere")).toBe(false);
    rerender(<Leaver dirty={false} />);
    expect(follow("Queue")).toBe(false);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

/** Stand-in for the Settings page: records what a section reports. */
function Recorder({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = React.useState<Record<string, UnsavedEntry>>({});
  const register = React.useCallback((id: string, e: UnsavedEntry | null) => {
    setEntries((prev) => {
      const next = { ...prev };
      if (e) next[id] = e;
      else delete next[id];
      return next;
    });
  }, []);
  return (
    <UnsavedChangesContext.Provider value={register}>
      {children}
      <UnsavedChangesBar entries={Object.values(entries)} />
    </UnsavedChangesContext.Provider>
  );
}

const mockFetch = jest.fn();

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

const PROMPTS = {
  prompts: [
    { key: "a", label: "Prompt A", description: "", value: "A0", default: "A0", is_overridden: false, updated_at: null },
    { key: "b", label: "Prompt B", description: "", value: "B0", default: "B0", is_overridden: false, updated_at: null },
  ],
};

describe("Prompts tab and the bar", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  function boxes() {
    return screen.getAllByRole("textbox") as HTMLTextAreaElement[];
  }

  it("shows the bar once a prompt is edited, and Discard puts the text back", async () => {
    mockFetch.mockImplementation(() => json(PROMPTS));
    render(
      <Recorder>
        <PromptsSection />
      </Recorder>
    );
    await screen.findByText("Prompt A");
    expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument();

    fireEvent.change(boxes()[0], { target: { value: "A1" } });
    expect(await screen.findByRole("region", { name: /unsaved changes/i })).toHaveTextContent(
      "Unsaved changes in Prompts"
    );

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(boxes()[0].value).toBe("A0");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument()
    );
    expect(mockFetch.mock.calls.some((c) => c[1]?.method === "PUT")).toBe(false);
  });

  it("the bar's Save stores every edited prompt", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({}) : json(PROMPTS)
    );
    render(
      <Recorder>
        <PromptsSection />
      </Recorder>
    );
    await screen.findByText("Prompt A");
    fireEvent.change(boxes()[0], { target: { value: "A1" } });
    fireEvent.change(boxes()[1], { target: { value: "B1" } });
    const bar = await screen.findByRole("region", { name: /unsaved changes/i });
    await userEvent.click(bar.querySelector("button:last-of-type") as HTMLElement);

    await waitFor(() => {
      const puts = mockFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
      expect(puts.map((c) => [c[0], JSON.parse(c[1].body)])).toEqual([
        ["/api/prompts/a", { value: "A1" }],
        ["/api/prompts/b", { value: "B1" }],
      ]);
    });
  });

  it("saving one prompt from its own button keeps the other prompt's unsaved text", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({}) : json(PROMPTS)
    );
    render(<PromptsSection />);
    await screen.findByText("Prompt A");
    fireEvent.change(boxes()[0], { target: { value: "A1" } });
    fireEvent.change(boxes()[1], { target: { value: "B1" } });

    await userEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]);
    await screen.findByText("Prompt saved");

    expect(boxes()[1].value).toBe("B1");
  });
});

const BACKUPS = {
  enabled: true,
  mounted: true,
  retention: { daily: 7, weekly: 4, monthly: 12 },
  last_run: null,
  db: { daily: [], weekly: [], monthly: [] },
  audio: [],
};

describe("Backups tab and the bar", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockImplementation(() => json(BACKUPS));
  });

  it("shows the bar once retention is edited, and Discard restores the numbers", async () => {
    render(
      <Recorder>
        <BackupsSection />
      </Recorder>
    );
    const daily = (await screen.findByLabelText("Daily")) as HTMLInputElement;
    fireEvent.change(daily, { target: { value: "3" } });
    expect(await screen.findByRole("region", { name: /unsaved changes/i })).toHaveTextContent(
      "Unsaved changes in Backups"
    );

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(daily.value).toBe("7");
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument()
    );
  });

  it("an invalid retention blocks the bar's Save", async () => {
    render(
      <Recorder>
        <BackupsSection />
      </Recorder>
    );
    const daily = await screen.findByLabelText("Daily");
    fireEvent.change(daily, { target: { value: "0" } });
    const bar = await screen.findByRole("region", { name: /unsaved changes/i });
    await act(async () => {});
    expect(bar).toHaveTextContent(/fix backups before saving/i);
    expect(bar.querySelector("button:last-of-type")).toBeDisabled();
  });
});
