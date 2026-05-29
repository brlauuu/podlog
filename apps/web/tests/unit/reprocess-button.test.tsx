/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

import ReprocessButton from "@/components/ReprocessButton";

const originalConfirm = window.confirm;
const originalAlert = window.alert;
const originalFetch = global.fetch;

afterEach(() => {
  window.confirm = originalConfirm;
  window.alert = originalAlert;
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("ReprocessButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses compact tag-like sizing classes", () => {
    render(<ReprocessButton episodeId="ep-1" />);

    const button = screen.getByRole("button", { name: /reprocess/i });
    expect(button).toHaveClass(
      "px-1.5",
      "py-0.5",
      "text-xs",
      "rounded",
      "font-medium",
      "border",
    );
  });

  it("does nothing when the user cancels the confirm prompt", async () => {
    window.confirm = jest.fn(() => false);
    const fetchMock = jest.fn();
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<ReprocessButton episodeId="ep-1" />);
    fireEvent.click(screen.getByRole("button", { name: /reprocess/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("POSTs to /api/episodes/{id}/retry and refreshes the router on success", async () => {
    window.confirm = jest.fn(() => true);
    const fetchMock = jest.fn(
      async () => ({ ok: true, json: async () => ({}) }) as Response,
    );
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<ReprocessButton episodeId="ep-42" />);
    fireEvent.click(screen.getByRole("button", { name: /reprocess/i }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/episodes/ep-42/retry", {
      method: "POST",
    });
  });

  it("alerts the server-provided detail string when the request fails", async () => {
    window.confirm = jest.fn(() => true);
    const alertMock = jest.fn();
    window.alert = alertMock;
    const fetchMock = jest.fn(
      async () => ({
        ok: false,
        status: 409,
        json: async () => ({ detail: "Already queued" }),
      }) as Response,
    );
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    render(<ReprocessButton episodeId="ep-1" />);
    fireEvent.click(screen.getByRole("button", { name: /reprocess/i }));

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith("Already queued"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a status-coded message when the error body has no detail", async () => {
    window.confirm = jest.fn(() => true);
    const alertMock = jest.fn();
    window.alert = alertMock;
    (global as { fetch: typeof fetch }).fetch = (jest.fn(
      async () => ({
        ok: false,
        status: 500,
        json: async () => null,
      }) as Response,
    ) as unknown) as typeof fetch;

    render(<ReprocessButton episodeId="ep-1" />);
    fireEvent.click(screen.getByRole("button", { name: /reprocess/i }));

    await waitFor(() =>
      expect(alertMock).toHaveBeenCalledWith("Request failed (500)"),
    );
  });

  it("shows a spinning icon and disables the button while in-flight", async () => {
    window.confirm = jest.fn(() => true);
    let resolveFetch: (r: Response) => void = () => {};
    (global as { fetch: typeof fetch }).fetch = (jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown) as typeof fetch;

    render(<ReprocessButton episodeId="ep-1" />);
    const button = screen.getByRole("button", { name: /reprocess/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector("svg")?.getAttribute("class") ?? "").toContain(
      "animate-spin",
    );
    expect(screen.getByRole("button")).toHaveTextContent(/Reprocessing/);

    // Resolve so the test cleans up.
    resolveFetch({ ok: true, json: async () => ({}) } as Response);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
