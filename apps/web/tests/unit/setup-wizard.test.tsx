/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WizardHealthCheck from "@/components/WizardHealthCheck";
import WizardAddFeed from "@/components/WizardAddFeed";
import WizardComplete from "@/components/WizardComplete";

const mockFetch = jest.fn();
global.fetch = mockFetch;

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockFetch.mockReset();
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
    expect(screen.getByText(/Add Your First Feed/i)).toBeInTheDocument();
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
