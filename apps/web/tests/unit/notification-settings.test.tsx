/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationSettings from "@/components/NotificationSettings";

// Radix Select needs pointer capture jsdom does not have; a native select keeps
// the model pickers on the Inference tab drivable. No other tab uses Select.
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => (
    <select
      data-testid="model-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

/** The diarization model picker: the second card on the Inference tab. */
async function diarizationSelect() {
  const heading = await screen.findByText("Diarization");
  return heading.closest("div.rounded-lg")!.querySelector("select") as HTMLSelectElement;
}

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const defaultSettings = {
  telegram_bot_token: null,
  telegram_chat_id: null,
  telegram_allowed_user_ids: null,
  notification_email_to: null,
  notification_email_from: "podlog@localhost",
  smtp_host: "host.docker.internal",
  smtp_port: 25,
  smtp_user: null,
  smtp_password: null,
  smtp_use_tls: false,
  notification_frequency: "immediate",
  health_check_notifications_enabled: true,
  embedding_model: "all-MiniLM-L6-v2",
  pyannote_model: "pyannote/speaker-diarization-community-1",
  rag_local_model: "qwen2.5:3b",
  telegram_configured: false,
  email_configured: false,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/hardware") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          hardware: null,
          profile: null,
          profile_label: null,
          estimates: {
            transcription_minutes_per_hour: null,
            embedding_seconds_per_hour: null,
            remote_transcription_minutes_per_hour: 3,
            remote_embedding_seconds_per_hour: 5,
            remote_cost_per_hour_usd: 0.36,
          },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ ...defaultSettings }),
    });
  });
});

describe("NotificationSettings", () => {
  it("renders all three tab triggers", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Inference" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Backups" })).toBeInTheDocument();
    });
  });

  // #1067: jsdom does no layout, so this pins the classes that produce the
  // 2x2 grid on phones rather than the rendered geometry.
  it("lays the four tabs out as a two-column grid below md (#1067)", async () => {
    render(<NotificationSettings />);
    const list = await screen.findByRole("tablist");
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(list).toHaveClass("grid", "grid-cols-2", "w-full", "md:inline-flex", "md:w-auto");
    expect(list).not.toHaveClass("flex-wrap");
    expect(list).not.toHaveClass("inline-flex");
  });

  it("shows telegram fields in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/chat id/i)).toBeInTheDocument();
    });
  });

  it("shows email fields in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByText(/send to/i)).toBeInTheDocument();
      expect(screen.getByText(/from address/i)).toBeInTheDocument();
    });
  });

  it("shows general settings in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/notification frequency/i)).toBeInTheDocument();
    });
  });

  it("shows pipeline step cards in Remote Inference tab", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    // Wait for tabs to be available
    const inferenceTab = await screen.findByRole("tab", { name: "Inference" });
    await user.click(inferenceTab);
    // Wait for the Remote Inference section to load with pipeline steps
    const transcription = await screen.findByText("Transcription");
    expect(transcription).toBeInTheDocument();
    expect(screen.getByText("Diarization")).toBeInTheDocument();
    expect(screen.getByText("Speaker Inference")).toBeInTheDocument();
    expect(screen.getByText("Embedding")).toBeInTheDocument();
    expect(screen.getByText("RAG / Ask")).toBeInTheDocument();
  });

  it("calls PUT on save in Notifications tab", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ hardware: null, profile: null, profile_label: null, estimates: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...defaultSettings }),
      });
    });

    render(<NotificationSettings />);
    const tokenInput = await screen.findByLabelText(/bot token/i);

    await user.clear(tokenInput);
    await user.type(tokenInput, "123:ABC");

    // Click the Save button in the active (Notifications) tab
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c: [string, RequestInit?]) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
    });
  });

  it("disables test button when telegram not configured", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      const testBtn = screen.getByRole("button", { name: /send test message/i });
      expect(testBtn).toBeDisabled();
    });
  });

  // #1069: Save moved from the foot of each tab into a floating bar that
  // exists only while something is unsaved.
  it("offers nothing to save on either tab when no changes were made (#1069)", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    await screen.findByLabelText(/bot token/i);
    expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Inference" }));
    await screen.findByText(/pyannote/i, undefined, { timeout: 2000 }).catch(() => null);
    expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("shows the bar after an edit and keeps it when the tab is changed (#1069)", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    await user.type(await screen.findByLabelText(/bot token/i), "123:ABC");

    const bar = await screen.findByRole("region", { name: /unsaved changes/i });
    expect(bar).toHaveTextContent("Unsaved changes in Notifications");

    await user.click(screen.getByRole("tab", { name: "Backups" }));
    expect(screen.getByRole("region", { name: /unsaved changes/i })).toHaveTextContent(
      "Unsaved changes in Notifications"
    );
  });

  it("Discard puts the field back and sends nothing (#1069)", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    const chat = (await screen.findByLabelText(/chat id/i)) as HTMLInputElement;
    const before = chat.value;
    await user.type(chat, "999");
    expect(chat.value).toBe(`${before}999`);

    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect((screen.getByLabelText(/chat id/i) as HTMLInputElement).value).toBe(before);
    expect(screen.queryByRole("region", { name: /unsaved changes/i })).not.toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some((c: [string, RequestInit?]) => c[1]?.method === "PUT")
    ).toBe(false);
  });

  it("one Save stores edits made on two tabs (#1069)", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    await user.type(await screen.findByLabelText(/chat id/i), "42");
    await user.click(screen.getByRole("tab", { name: "Inference" }));
    fireEvent.change(await diarizationSelect(), {
      target: { value: "pyannote/speaker-diarization-3.1" },
    });

    const bar = await screen.findByRole("region", { name: /unsaved changes/i });
    expect(bar).toHaveTextContent("Unsaved changes in Notifications and Inference");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const bodies = mockFetch.mock.calls
        .filter((c: [string, RequestInit?]) => c[1]?.method === "PUT")
        .map((c: [string, RequestInit?]) => JSON.parse(c[1]!.body as string));
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toEqual({ telegram_chat_id: "42" });
      expect(bodies[1]).toEqual({ pyannote_model: "pyannote/speaker-diarization-3.1" });
    });
  });

  it("Inference Save enables and PUTs pyannote_model when changed (#688)", async () => {
    // Regression: diarization fields used to land in dirtyNotifications, so
    // the Inference-tab Save button stayed disabled and the change was lost.
    const user = userEvent.setup();
    render(<NotificationSettings />);
    await user.click(await screen.findByRole("tab", { name: "Inference" }));

    fireEvent.change(await diarizationSelect(), {
      target: { value: "pyannote/speaker-diarization-3.1" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
    });
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c: [string, RequestInit?]) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
      expect(JSON.parse(putCall![1]!.body as string)).toEqual({
        pyannote_model: "pyannote/speaker-diarization-3.1",
      });
    });
  });
});

describe("Email tag input", () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ hardware: null, profile: null, profile_label: null, estimates: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...defaultSettings,
          notification_email_to: "existing@example.com",
          email_configured: true,
        }),
      });
    });
  });

  it("displays existing emails as tags", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByText("existing@example.com")).toBeInTheDocument();
    });
  });

  it("adds a valid email on Enter", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("new@example.com")).toBeInTheDocument();
  });

  it("rejects an invalid email with error message", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
  });

  it("removes an email when X is clicked", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText("existing@example.com")).not.toBeInTheDocument();
  });

  it("prevents duplicate emails", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "existing@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/already added/i)).toBeInTheDocument();
  });
});

describe("NotificationSettings — save, test, and error paths", () => {
  it("renders the shape-mismatch error when settings fail schema validation", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({ ok: true, json: async () => ({ estimates: {} }) });
      }
      // A non-object body fails SettingsSchema.safeParse outright.
      return Promise.resolve({ ok: true, json: async () => "bad" });
    });

    render(<NotificationSettings />);

    expect(
      await screen.findByText(/didn't match the expected schema/i)
    ).toBeInTheDocument();
  });

  it("shows an error toast when a notification save returns an error", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/hardware") {
        return Promise.resolve({ ok: true, json: async () => ({ estimates: {} }) });
      }
      if (opts?.method === "PUT") {
        return Promise.resolve({ ok: false, json: async () => ({ error: "save boom" }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ...defaultSettings }) });
    });

    render(<NotificationSettings />);
    const token = await screen.findByLabelText(/bot token/i);
    await user.clear(token);
    await user.type(token, "123:ABC");
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);

    expect(await screen.findByText(/save boom/)).toBeInTheDocument();
  });

  it("shows a network-error toast when a notification save throws", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/hardware") {
        return Promise.resolve({ ok: true, json: async () => ({ estimates: {} }) });
      }
      if (opts?.method === "PUT") return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: true, json: async () => ({ ...defaultSettings }) });
    });

    render(<NotificationSettings />);
    const token = await screen.findByLabelText(/bot token/i);
    await user.clear(token);
    await user.type(token, "123:ABC");
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it("sends a Telegram test message and toasts success", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/hardware") {
        return Promise.resolve({ ok: true, json: async () => ({ estimates: {} }) });
      }
      if (url === "/api/notifications/test") {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...defaultSettings, telegram_configured: true }),
      });
    });

    render(<NotificationSettings />);
    const testBtn = await screen.findByRole("button", { name: /send test message/i });
    await waitFor(() => expect(testBtn).not.toBeDisabled());
    await user.click(testBtn);

    expect(await screen.findByText(/Test message sent/)).toBeInTheDocument();
    const postCall = mockFetch.mock.calls.find(
      (c: [string, RequestInit?]) => c[0] === "/api/notifications/test"
    );
    expect(JSON.parse(postCall![1]!.body as string)).toEqual({ channel: "telegram" });
  });

  it("toasts the error when a Telegram test fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({ ok: true, json: async () => ({ estimates: {} }) });
      }
      if (url === "/api/notifications/test") {
        return Promise.resolve({ ok: false, json: async () => ({ error: "test failed" }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...defaultSettings, telegram_configured: true }),
      });
    });

    render(<NotificationSettings />);
    const testBtn = await screen.findByRole("button", { name: /send test message/i });
    await waitFor(() => expect(testBtn).not.toBeDisabled());
    await user.click(testBtn);

    expect(await screen.findByText(/test failed/)).toBeInTheDocument();
  });
});
