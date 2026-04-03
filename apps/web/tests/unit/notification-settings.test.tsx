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
      telegram_configured: false,
      email_configured: false,
    }),
  });
});

describe("NotificationSettings", () => {
  it("renders three tabs", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /telegram/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /email/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /general/i })).toBeInTheDocument();
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
        telegram_configured: false,
        email_configured: true,
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
