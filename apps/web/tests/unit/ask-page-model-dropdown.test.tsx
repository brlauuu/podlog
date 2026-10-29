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

function makeFetch(settings: Record<string, unknown> = {}) {
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
        json: async () => settings,
      } as Response);
    }
    return Promise.resolve({ json: async () => ({}) } as Response);
  }) as jest.Mock;
}

describe("Ask page model dropdown", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  test("offers only Ollama models", async () => {
    global.fetch = makeFetch();
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

  // #1092: a browser that used the retired Fireworks toggle still has a
  // Fireworks model stored. It must not reach the dropdown as an empty value.
  test("replaces a remembered Fireworks model with the configured local model", async () => {
    localStorage.setItem("podlog-ask-model", "accounts/fireworks/models/gpt-oss-120b");
    global.fetch = makeFetch({ rag_local_model: "phi3:mini" });
    render(<AskPage />);

    const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("phi3:mini"));
  });

  test("applies backend rag_local_model on a fresh browser when no localStorage preference is set (#637)", async () => {
    // Fresh browser: no podlog-ask-model in localStorage. Backend has the
    // admin-configured rag_local_model = phi3:mini. Verify the dropdown shows
    // phi3:mini, not the hardcoded DEFAULT_RAG_MODEL (qwen2.5:3b).
    global.fetch = jest.fn((url: string) => {
      if (url === "/api/feeds") return Promise.resolve({ json: async () => [] } as Response);
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
        } as Response);
      }
      if (url === "/api/notifications/settings") {
        return Promise.resolve({
          json: async () => ({ rag_provider: "local", rag_local_model: "phi3:mini" }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    }) as jest.Mock;

    render(<AskPage />);

    await waitFor(() => {
      const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
      expect(select.value).toBe("phi3:mini");
    });
  });

  test("applies backend rag_local_model when localStorage has a stale wrong-provider value (#637)", async () => {
    // User previously used Fireworks and has a Fireworks path stored. The
    // admin has switched rag_provider back to local with rag_local_model =
    // phi3:mini. The stale Fireworks path is invalid for the local provider,
    // so the backend default should win.
    localStorage.setItem(
      "podlog-ask-model",
      "accounts/fireworks/models/qwen2p5-7b-instruct",
    );
    global.fetch = jest.fn((url: string) => {
      if (url === "/api/feeds") return Promise.resolve({ json: async () => [] } as Response);
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
        } as Response);
      }
      if (url === "/api/notifications/settings") {
        return Promise.resolve({
          json: async () => ({ rag_provider: "local", rag_local_model: "phi3:mini" }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    }) as jest.Mock;

    render(<AskPage />);

    await waitFor(() => {
      const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
      expect(select.value).toBe("phi3:mini");
    });
  });

  test("respects an existing valid localStorage preference over the backend rag_local_model (#637)", async () => {
    // User has previously picked qwen2.5:3b on the Ask page. Backend says
    // phi3:mini. Per-session preference must win.
    localStorage.setItem("podlog-ask-model", "qwen2.5:3b");
    global.fetch = jest.fn((url: string) => {
      if (url === "/api/feeds") return Promise.resolve({ json: async () => [] } as Response);
      if (url === "/api/ask/coverage") {
        return Promise.resolve({
          json: async () => ({ processed: 1, total: 1, has_manual_uploads: false }),
        } as Response);
      }
      if (url === "/api/notifications/settings") {
        return Promise.resolve({
          json: async () => ({ rag_provider: "local", rag_local_model: "phi3:mini" }),
        } as Response);
      }
      return Promise.resolve({ json: async () => ({}) } as Response);
    }) as jest.Mock;

    render(<AskPage />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/notifications/settings"));
    const select = screen.getByLabelText(/model:/i) as HTMLSelectElement;
    expect(select.value).toBe("qwen2.5:3b");
  });

});
