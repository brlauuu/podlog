/**
 * @jest-environment jsdom
 */
/**
 * Tests for the Footer's version + stale-build display (#744).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Footer from "@/components/Footer";

const ORIGINAL_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

function setBuiltInVersion(v: string | undefined) {
  if (v === undefined) {
    delete process.env.NEXT_PUBLIC_APP_VERSION;
  } else {
    process.env.NEXT_PUBLIC_APP_VERSION = v;
  }
}

function jsonResp(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

afterAll(() => {
  setBuiltInVersion(ORIGINAL_VERSION);
});

describe("Footer", () => {
  it("renders only v{version} when on-disk matches built-in", async () => {
    setBuiltInVersion("0.4.6");
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResp({ built_in: "0.4.6", on_disk: "0.4.6" })),
    ) as unknown as typeof fetch;

    
    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("v0.4.6")).toBeInTheDocument();
    });
    expect(screen.queryByText(/rebuild available/i)).not.toBeInTheDocument();
  });

  it("shows the rebuild hint when on-disk is newer than built-in", async () => {
    setBuiltInVersion("0.3.0");
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResp({ built_in: "0.3.0", on_disk: "0.4.6" })),
    ) as unknown as typeof fetch;

    
    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText(/0.4.6 \(rebuild available\)/i)).toBeInTheDocument();
    });
    // Original built-in version is still shown so the user can see both.
    expect(screen.getByText(/v0\.3\.0/i)).toBeInTheDocument();
  });

  it("stays silent when on-disk is older than built-in (downgrade / branch checkout)", async () => {
    setBuiltInVersion("0.4.6");
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResp({ built_in: "0.4.6", on_disk: "0.3.0" })),
    ) as unknown as typeof fetch;

    
    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("v0.4.6")).toBeInTheDocument();
    });
    expect(screen.queryByText(/rebuild available/i)).not.toBeInTheDocument();
  });

  it("stays silent when on-disk is null (file missing, no mount)", async () => {
    setBuiltInVersion("0.4.6");
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResp({ built_in: "0.4.6", on_disk: null })),
    ) as unknown as typeof fetch;

    
    render(<Footer />);

    await waitFor(() => {
      expect(screen.getByText("v0.4.6")).toBeInTheDocument();
    });
    expect(screen.queryByText(/rebuild available/i)).not.toBeInTheDocument();
  });

  it("stays silent when the fetch fails", async () => {
    setBuiltInVersion("0.4.6");
    global.fetch = jest.fn(() => Promise.reject(new Error("network"))) as unknown as typeof fetch;

    
    render(<Footer />);

    expect(await screen.findByText("v0.4.6")).toBeInTheDocument();
    expect(screen.queryByText(/rebuild available/i)).not.toBeInTheDocument();
  });
});
