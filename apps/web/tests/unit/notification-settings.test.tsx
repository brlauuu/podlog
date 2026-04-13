/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationSettings from "@/components/NotificationSettings";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const defaultSettings = {
  telegram_bot_token: null,
  telegram_chat_id: null,
  notification_email_to: null,
  notification_email_from: "podlog@localhost",
  smtp_host: "host.docker.internal",
  smtp_port: 25,
  smtp_user: null,
  smtp_password: null,
  smtp_use_tls: false,
  notification_frequency: "immediate",
  health_check_notifications_enabled: true,
  inference_provider: "local",
  fireworks_api_key: null,
  fireworks_audio_base_url: "https://audio-turbo.api.fireworks.ai",
  fireworks_stt_model: "whisper-v3-turbo",
  fireworks_stt_diarize: true,
  fireworks_stt_cost_per_minute_usd: 0.006,
  fireworks_chat_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_chat_model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
  embedding_provider: "local",
  embedding_model: "all-MiniLM-L6-v2",
  fireworks_embedding_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_embedding_model: "BAAI/bge-small-en-v1.5",
  telegram_configured: false,
  email_configured: false,
  fireworks_configured: false,
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
  it("renders both tab triggers", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Remote Inference" })).toBeInTheDocument();
    });
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
    const inferenceTab = await screen.findByRole("tab", { name: "Remote Inference" });
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
    await waitFor(() => screen.getByLabelText(/bot token/i));

    fireEvent.change(screen.getByLabelText(/bot token/i), {
      target: { value: "123:ABC" },
    });

    // Click the Save button in the active (Notifications) tab
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    fireEvent.click(saveButtons[0]);

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

  it("shows fireworks API key field in Remote Inference tab", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    const inferenceTab = await screen.findByRole("tab", { name: "Remote Inference" });
    await user.click(inferenceTab);
    // The API key field should be available after the tab content is rendered
    const apiKeyLabel = await screen.findByText(/fireworks api key/i);
    expect(apiKeyLabel).toBeInTheDocument();
  });

  it("Notifications Save button is disabled when no changes", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/bot token/i));
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    expect(saveButtons[0]).toBeDisabled();
  });

  it("Remote Inference Save button is disabled when no changes", async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);
    const inferenceTab = await screen.findByRole("tab", { name: "Remote Inference" });
    await user.click(inferenceTab);
    // After clicking Remote Inference tab, the Save button should be visible and disabled (no changes made)
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: /save/i });
      expect(saveBtn).toBeDisabled();
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
