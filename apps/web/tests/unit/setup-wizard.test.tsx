/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WizardHealthCheck from "@/components/WizardHealthCheck";

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
