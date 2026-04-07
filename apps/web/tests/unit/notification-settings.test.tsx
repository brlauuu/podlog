/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import NotificationSettings from "@/components/NotificationSettings";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Default: GET returns unconfigured settings
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
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
      inference_provider: "local",
      fireworks_api_key: null,
      fireworks_audio_base_url: "https://audio-turbo.api.fireworks.ai",
      fireworks_stt_model: "whisper-v3-large",
      fireworks_stt_diarize: true,
      fireworks_stt_cost_per_minute_usd: 0.006,
      telegram_configured: false,
      email_configured: false,
      fireworks_configured: false,
    }),
  });
});

describe("NotificationSettings", () => {
  it("renders four tabs", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /telegram/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /email/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /fireworks ai/i })).toBeInTheDocument();
    });
  });

  it("shows telegram tab content by default", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/chat id/i)).toBeInTheDocument();
    });
  });

  it("switches to email tab on click", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByText(/send to/i)).toBeInTheDocument();
  });

  it("switches to general tab on click", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /general/i }));
    fireEvent.click(screen.getByRole("tab", { name: /general/i }));
    expect(screen.getByLabelText(/notification frequency/i)).toBeInTheDocument();
  });

  it("calls PUT on save", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          telegram_bot_token: null,
          telegram_chat_id: null,
          telegram_configured: false,
          email_configured: false,
          notification_frequency: "immediate",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ telegram_configured: true }),
      });

    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/bot token/i));

    fireEvent.change(screen.getByLabelText(/bot token/i), {
      target: { value: "123:ABC" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c: [string, RequestInit?]) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
    });
  });

  it("disables test button when channel not configured", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      const testBtn = screen.getByRole("button", { name: /send test message/i });
      expect(testBtn).toBeDisabled();
    });
  });

  it("switches to fireworks tab on click", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /fireworks ai/i }));
    fireEvent.click(screen.getByRole("tab", { name: /fireworks ai/i }));
    expect(screen.getByLabelText(/inference provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fireworks api key/i)).toBeInTheDocument();
  });
});

describe("Email tag input", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        telegram_bot_token: null,
        telegram_chat_id: null,
        notification_email_to: "existing@example.com",
        notification_email_from: "podlog@localhost",
        smtp_host: "host.docker.internal",
        smtp_port: 25,
        smtp_user: null,
        smtp_password: null,
        smtp_use_tls: false,
        notification_frequency: "immediate",
        inference_provider: "local",
        fireworks_api_key: null,
        fireworks_audio_base_url: "https://audio-turbo.api.fireworks.ai",
        fireworks_stt_model: "whisper-v3-large",
        fireworks_stt_diarize: true,
        fireworks_stt_cost_per_minute_usd: 0.006,
        telegram_configured: false,
        email_configured: true,
        fireworks_configured: false,
      }),
    });
  });

  it("displays existing emails as tags", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByText("existing@example.com")).toBeInTheDocument();
  });

  it("adds a valid email on Enter", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("new@example.com")).toBeInTheDocument();
  });

  it("rejects an invalid email with error message", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    expect(screen.queryByText("not-an-email")).not.toBeInTheDocument();
  });

  it("removes an email when X is clicked", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText("existing@example.com")).not.toBeInTheDocument();
  });

  it("shows not configured when all emails removed", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("prevents duplicate emails", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "existing@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/already added/i)).toBeInTheDocument();
  });
});

it("tab dot reflects unconfigured state after removing all emails", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      telegram_bot_token: null,
      telegram_chat_id: null,
      notification_email_to: "user@test.com",
      notification_email_from: "podlog@localhost",
      smtp_host: "host.docker.internal",
      smtp_port: 25,
      smtp_user: null,
      smtp_password: null,
      smtp_use_tls: false,
      notification_frequency: "immediate",
      inference_provider: "local",
      fireworks_api_key: null,
      fireworks_audio_base_url: "https://audio-turbo.api.fireworks.ai",
      fireworks_stt_model: "whisper-v3-large",
      fireworks_stt_diarize: true,
      fireworks_stt_cost_per_minute_usd: 0.006,
      telegram_configured: false,
      email_configured: true,
      fireworks_configured: false,
    }),
  });

  render(<NotificationSettings />);
  await waitFor(() => screen.getByRole("tab", { name: /email/i }));
  fireEvent.click(screen.getByRole("tab", { name: /email/i }));

  // Remove the only email
  const removeBtn = screen.getByRole("button", { name: /remove user@test.com/i });
  fireEvent.click(removeBtn);

  // The email tab dot should now reflect unconfigured
  const emailTab = screen.getByRole("tab", { name: /email/i });
  const dot = emailTab.querySelector("span.rounded-full");
  expect(dot?.className).toContain("bg-muted-foreground");
});
