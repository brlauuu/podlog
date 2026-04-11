/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WizardHealthCheck from "@/components/WizardHealthCheck";
import WizardAddFeed from "@/components/WizardAddFeed";
import WizardComplete from "@/components/WizardComplete";
import SetupWizard from "@/components/SetupWizard";
import { useWizard } from "@/components/WizardProvider";

// Mock WizardProvider context
jest.mock("@/components/WizardProvider", () => ({
  useWizard: jest.fn(),
}));

const mockUseWizard = useWizard as jest.Mock;
const mockPush = jest.fn();

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPush.mockReset();
});

describe("WizardHealthCheck", () => {
  const noop = () => {};

  it("shows all services as healthy when API returns OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Database")).toBeInTheDocument();
      expect(screen.getByText("Pipeline API")).toBeInTheDocument();
      expect(screen.getByText("Worker")).toBeInTheDocument();
    });

    const badges = screen.getAllByText(/Connected|Healthy|Ready/);
    expect(badges).toHaveLength(3);
  });

  it("shows warming up state for worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "WARMING_UP",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "WARMING_UP" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Downloading models/i)).toBeInTheDocument();
    });
  });

  it("shows all-ready banner when every service is OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/All systems ready/i)).toBeInTheDocument();
    });
  });
});

describe("WizardAddFeed", () => {
  const noop = () => {};

  it("renders URL input and mode selector with test pre-selected", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);

    expect(screen.getByPlaceholderText(/feeds\.example\.com/i)).toBeInTheDocument();
    const testBtn = screen.getByRole("button", { name: /test/i });
    expect(testBtn).toBeInTheDocument();
  });

  it("shows skip button", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("mentions manual upload path from Sources page", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);
    expect(screen.getByText(/upload audio anytime/i)).toBeInTheDocument();
    expect(screen.getByText("/podcasts")).toBeInTheDocument();
  });

  it("submits feed in test mode", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "feed-1", title: "Test Podcast" }),
    });

    const onNext = jest.fn();
    render(<WizardAddFeed onNext={onNext} onBack={noop} onSkip={noop} />);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://example.com/feed.xml" } });

    const addBtn = screen.getByRole("button", { name: /add feed/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/feeds", expect.objectContaining({
        method: "POST",
      }));
      expect(onNext).toHaveBeenCalled();
    });
  });

  it("shows error on failed submission", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Invalid RSS feed URL" }),
    });

    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://bad-url" } });

    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid RSS feed URL/i)).toBeInTheDocument();
    });
  });

  it("shows back button that calls onBack", () => {
    const onBack = jest.fn();
    render(<WizardAddFeed onNext={noop} onBack={onBack} onSkip={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /← back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it("can switch to selective mode", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);
    const selectiveBtn = screen.getByText("Selective").closest("button")!;
    fireEvent.click(selectiveBtn);
    // In selective mode, the submit button says "Next" instead of "Add Feed"
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  it("can switch to full mode", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);
    const fullBtn = screen.getByText("Full").closest("button")!;
    fireEvent.click(fullBtn);
    expect(screen.getByRole("button", { name: /add feed/i })).toBeInTheDocument();
  });

  it("fetches preview in selective mode before submitting", async () => {
    // First call: preview fetch, second call: actual submit
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "My Podcast",
          episodes: [
            { guid: "ep-1", title: "Episode 1", published_at: "2025-01-01", duration_secs: 3600 },
            { guid: "ep-2", title: "Episode 2", published_at: "2025-01-02", duration_secs: 1800 },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "feed-1" }),
      });

    const onNext = jest.fn();
    render(<WizardAddFeed onNext={onNext} onBack={noop} onSkip={noop} />);

    // Switch to selective mode
    fireEvent.click(screen.getByText("Selective").closest("button")!);

    // Enter URL
    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://example.com/feed.xml" } });

    // Click Next to fetch preview
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/preview",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: "https://example.com/feed.xml" }),
        })
      );
    });

    // Episode picker should appear
    await waitFor(() => {
      expect(screen.getByText("Episode 1")).toBeInTheDocument();
      expect(screen.getByText("Episode 2")).toBeInTheDocument();
      expect(screen.getByText("My Podcast")).toBeInTheDocument();
    });

    // Select an episode
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    await waitFor(() => {
      expect(screen.getByText("1 episodes selected")).toBeInTheDocument();
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /add 1 episodes/i }));

    await waitFor(() => {
      expect(onNext).toHaveBeenCalled();
    });
  });

  it("shows error when preview fetch fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Feed not found" }),
    });

    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);

    // Switch to selective mode
    fireEvent.click(screen.getByText("Selective").closest("button")!);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://example.com/bad.xml" } });

    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Feed not found/i)).toBeInTheDocument();
    });
  });

  it("submits feed in full mode", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "feed-1" }),
    });

    const onNext = jest.fn();
    render(<WizardAddFeed onNext={onNext} onBack={noop} onSkip={noop} />);

    // Switch to full mode
    fireEvent.click(screen.getByText("Full").closest("button")!);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://example.com/feed.xml" } });

    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/feeds", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"mode":"full"'),
      }));
      expect(onNext).toHaveBeenCalled();
    });
  });
});

describe("WizardComplete", () => {
  it("shows 'You're All Set!' when feed was added", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText(/You're All Set/i)).toBeInTheDocument();
  });

  it("shows 'Ready When You Are' when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText(/Ready When You Are/i)).toBeInTheDocument();
  });

  it("highlights 'Add Your First Feed' link when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    const cta = screen.getByText(/Add Your First Feed/i).closest("a");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveClass("border-blue-500");
  });

  it("links Search CTA to /search when feed was added", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Search").closest("a")).toHaveAttribute("href", "/search");
  });

  it("links Search CTA to /search when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Search").closest("a")).toHaveAttribute("href", "/search");
  });

  it("shows Upload Audio link to /podcasts when feed was added", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Upload Audio").closest("a")).toHaveAttribute("href", "/podcasts");
  });

  it("shows Upload Audio link to /podcasts when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Upload Audio").closest("a")).toHaveAttribute("href", "/podcasts");
  });

  it("shows 'Don't show this wizard' checkbox", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByLabelText(/Don't show this wizard/i)).toBeInTheDocument();
  });

  it("calls onDontShowChange when checkbox is toggled", () => {
    const onChange = jest.fn();
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Don't show this wizard/i));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("WizardHealthCheck — fallback on error", () => {
  it("shows Unknown badges when health check fails", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    render(<WizardHealthCheck onNext={() => {}} onSkip={() => {}} />, { wrapper });

    await waitFor(() => {
      const unknowns = screen.getAllByText("UNKNOWN");
      expect(unknowns).toHaveLength(3);
    });
  });
});

describe("WizardComplete — Ask AI link", () => {
  it("shows Ask AI link when feed was added", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Ask AI")).toBeInTheDocument();
  });

  it("shows Ask AI link when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText("Ask AI")).toBeInTheDocument();
  });
});

describe("WizardProvider", () => {
  const actualWizardModule = jest.requireActual<typeof import("@/components/WizardProvider")>(
    "@/components/WizardProvider"
  );
  const ActualWizardProvider = actualWizardModule.default;
  const actualUseWizard = actualWizardModule.useWizard;

  function WizardOpenStateProbe() {
    const { open } = actualUseWizard();
    return <div data-testid="wizard-open-state">{open ? "open" : "closed"}</div>;
  }

  it("auto-opens the wizard when /api/wizard/status reports incomplete", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ completed: false }),
    });

    render(
      <ActualWizardProvider>
        <WizardOpenStateProbe />
      </ActualWizardProvider>
    );

    expect(screen.getByTestId("wizard-open-state")).toHaveTextContent("closed");

    await waitFor(() => {
      expect(screen.getByTestId("wizard-open-state")).toHaveTextContent("open");
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/wizard/status");
  });

  it("falls back to opening the wizard when /api/wizard/status fails", async () => {
    mockFetch.mockRejectedValue(new Error("status unavailable"));

    render(
      <ActualWizardProvider>
        <WizardOpenStateProbe />
      </ActualWizardProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("wizard-open-state")).toHaveTextContent("open");
    });
  });
});

describe("SetupWizard", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });
  });

  it("renders nothing when closed", () => {
    mockUseWizard.mockReturnValue({ open: false, setOpen: jest.fn(), markCompleted: jest.fn() });
    const { container } = render(<SetupWizard />, { wrapper });
    expect(container.innerHTML).toBe("");
  });

  it("renders Screen 1 when open", async () => {
    mockUseWizard.mockReturnValue({ open: true, setOpen: jest.fn(), markCompleted: jest.fn() });
    render(<SetupWizard />, { wrapper });
    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
  });

  it("shows clickable step dots", async () => {
    mockUseWizard.mockReturnValue({ open: true, setOpen: jest.fn(), markCompleted: jest.fn() });
    render(<SetupWizard />, { wrapper });
    await waitFor(() => {
      expect(screen.getByTestId("step-dots")).toBeInTheDocument();
    });
    const dots = screen.getByTestId("step-dots").querySelectorAll("button");
    expect(dots).toHaveLength(3);
    // Step 1 is current, steps 2 and 3 are disabled (not yet visited)
    expect(dots[1]).toBeDisabled();
    expect(dots[2]).toBeDisabled();
  });

  it("renders accessible dialog title/description and fullscreen sizing", async () => {
    mockUseWizard.mockReturnValue({ open: true, setOpen: jest.fn(), markCompleted: jest.fn() });
    render(<SetupWizard />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Setup Wizard")).toBeInTheDocument();
      expect(screen.getByText("First-run onboarding for health checks, feed setup, and next steps.")).toBeInTheDocument();
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("h-[calc(100vh-2rem)]");
  });

  it("calls markCompleted(false) on finish when checkbox unchecked", async () => {
    const mockMarkCompleted = jest.fn();
    const mockSetOpen = jest.fn();
    mockUseWizard.mockReturnValue({ open: true, setOpen: mockSetOpen, markCompleted: mockMarkCompleted });
    render(<SetupWizard />, { wrapper });

    // Navigate to screen 2
    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Add a feed to advance to screen 3
    await waitFor(() => {
      expect(screen.getByText(/Add Your First Podcast/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/feeds\.example\.com/i), {
      target: { value: "https://example.com/feed.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    // On screen 3, click "Get Started" without checking the box
    await waitFor(() => {
      expect(screen.getByText(/You're All Set!/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(mockMarkCompleted).toHaveBeenCalledWith(false);
  });

  it("advances to screen 3 when Skip is clicked on screen 2", async () => {
    const mockMarkCompleted = jest.fn();
    const mockSetOpen = jest.fn();
    mockUseWizard.mockReturnValue({ open: true, setOpen: mockSetOpen, markCompleted: mockMarkCompleted });
    render(<SetupWizard />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Add Your First Podcast/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    expect(mockMarkCompleted).not.toHaveBeenCalled();
    expect(mockSetOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/Ready When You Are/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });

  it("does not mark wizard completed when Skip wizard is clicked on screen 1", async () => {
    const mockMarkCompleted = jest.fn();
    const mockSetOpen = jest.fn();
    mockUseWizard.mockReturnValue({ open: true, setOpen: mockSetOpen, markCompleted: mockMarkCompleted });
    render(<SetupWizard />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /skip wizard/i }));

    expect(mockMarkCompleted).not.toHaveBeenCalled();
    expect(mockSetOpen).toHaveBeenCalledWith(false);
  });

  it("uses link destination from completion cards instead of generic onFinish redirect", async () => {
    const mockMarkCompleted = jest.fn();
    const mockSetOpen = jest.fn();
    mockUseWizard.mockReturnValue({ open: true, setOpen: mockSetOpen, markCompleted: mockMarkCompleted });
    render(<SetupWizard />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Add Your First Podcast/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    await waitFor(() => {
      expect(screen.getByText(/Ready When You Are/i)).toBeInTheDocument();
    });

    const targetLink = screen.getByRole("link", { name: /add your first feed/i });
    fireEvent.click(targetLink);

    expect(mockMarkCompleted).toHaveBeenCalledWith(false);
    expect(mockSetOpen).toHaveBeenCalledWith(false);
    expect(mockPush).not.toHaveBeenCalledWith("/");
  });

  it("does not trigger generic /queue redirect when clicking completion links after adding a feed", async () => {
    const mockMarkCompleted = jest.fn();
    const mockSetOpen = jest.fn();
    mockUseWizard.mockReturnValue({ open: true, setOpen: mockSetOpen, markCompleted: mockMarkCompleted });
    render(<SetupWizard />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Add Your First Podcast/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/feeds\.example\.com/i), {
      target: { value: "https://example.com/feed.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    await waitFor(() => {
      expect(screen.getByText(/You're All Set!/i)).toBeInTheDocument();
    });

    const searchLink = screen.getByRole("link", { name: /search/i });
    fireEvent.click(searchLink);

    expect(mockMarkCompleted).toHaveBeenCalledWith(false);
    expect(mockSetOpen).toHaveBeenCalledWith(false);
    expect(mockPush).not.toHaveBeenCalledWith("/queue");
  });
});
