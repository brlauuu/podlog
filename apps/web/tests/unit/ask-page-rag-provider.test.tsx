/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/AudioPlayerContext", () => ({
  useAudioPlayer: () => ({
    playEpisode: jest.fn(),
  }),
}));

jest.mock("next/link", () => {
  function MockLink({ href, children, ...props }: { href: string; children: React.ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  MockLink.displayName = "MockLink";
  return MockLink;
});

import AskPage from "@/app/ask/page";

function makeFetch(ragProvider: "local" | "fireworks") {
  return jest.fn((url: string) => {
    if (url === "/api/feeds") {
      return Promise.resolve({ json: async () => [] } as Response);
    }
    if (url === "/api/ask/coverage") {
      return Promise.resolve({
        json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
      } as Response);
    }
    if (url === "/api/notifications/settings") {
      return Promise.resolve({
        json: async () => ({ rag_provider: ragProvider }),
      } as Response);
    }
    return Promise.resolve({ json: async () => ({}) } as Response);
  }) as jest.Mock;
}

describe("Ask page provider-aware dropdown (#608 PR 3)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  test("renders Ollama models when rag_provider is local", async () => {
    global.fetch = makeFetch("local");
    render(<AskPage />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/notifications/settings"));

    const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // Ollama short names; no `accounts/` prefix.
    expect(optionValues).toContain("qwen2.5:3b");
    expect(optionValues.every((v) => !v.startsWith("accounts/"))).toBe(true);
    // No "(remote)" tag.
    expect(screen.queryByText(/\(remote\)/i)).toBeNull();
  });

  test("renders Fireworks chat models when rag_provider is fireworks", async () => {
    global.fetch = makeFetch("fireworks");
    render(<AskPage />);

    // Wait for the dropdown to contain Fireworks paths.
    await waitFor(() => {
      const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(
        optionValues.some((v) => v.startsWith("accounts/fireworks/models/")),
      ).toBe(true);
    });

    // Remote tag is shown next to the dropdown.
    expect(screen.getByText(/\(remote\)/i)).toBeInTheDocument();

    // None of the options are Ollama-style names.
    const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues.every((v) => v.startsWith("accounts/"))).toBe(true);
  });

  test("migrates a stale localStorage Ollama name when provider is fireworks", async () => {
    // Simulate the bug case: user's localStorage has `phi3:mini` from a
    // previous local session, but rag_provider is now fireworks.
    localStorage.setItem("podlog-ask-model", "phi3:mini");
    global.fetch = makeFetch("fireworks");
    render(<AskPage />);

    await waitFor(() => {
      const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
      // The selected value is now a Fireworks path, not the stale Ollama name.
      expect(select.value).toMatch(/^accounts\/fireworks\/models\//);
    });

    // localStorage was overwritten with the new Fireworks default.
    expect(localStorage.getItem("podlog-ask-model")).toMatch(
      /^accounts\/fireworks\/models\//,
    );
  });
});
