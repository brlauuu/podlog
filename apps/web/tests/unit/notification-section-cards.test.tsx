/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TelegramNotificationCard,
  EmailNotificationCard,
  GeneralNotificationCard,
} from "@/components/NotificationSectionCards";
import type { Settings } from "@/components/NotificationSettingsSections";

function makeSettings(overrides: Record<string, unknown> = {}): Settings {
  return {
    telegram_bot_token: null,
    telegram_chat_id: null,
  telegram_allowed_user_ids: null,
    telegram_configured: false,
    notification_email_to: null,
    notification_email_from: "podlog@localhost",
    email_configured: false,
    smtp_host: "host.docker.internal",
    smtp_port: 25,
    smtp_user: null,
    smtp_password: null,
    smtp_use_tls: false,
    notification_frequency: "immediate",
    health_check_notifications_enabled: true,
    ...overrides,
  } as unknown as Settings;
}

describe("TelegramNotificationCard", () => {
  it("edits the chat id and bot token via onChange", () => {
    const onChange = jest.fn();
    render(
      <TelegramNotificationCard
        settings={makeSettings()}
        onChange={onChange}
        onTest={jest.fn()}
        testing={false}
      />
    );

    fireEvent.change(screen.getByLabelText("Bot Token"), {
      target: { value: "123:ABC" },
    });
    expect(onChange).toHaveBeenCalledWith("telegram_bot_token", "123:ABC");

    fireEvent.change(screen.getByLabelText("Chat ID"), {
      target: { value: "42" },
    });
    expect(onChange).toHaveBeenCalledWith("telegram_chat_id", "42");
  });

  it("edits the bot allowlist via onChange (#1034)", () => {
    const onChange = jest.fn();
    render(
      <TelegramNotificationCard
        settings={makeSettings({ telegram_allowed_user_ids: "1" })}
        onChange={onChange}
        onTest={jest.fn()}
        testing={false}
      />
    );

    const input = screen.getByLabelText("Allowed user IDs") as HTMLInputElement;
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "1, 2" } });
    expect(onChange).toHaveBeenCalledWith("telegram_allowed_user_ids", "1, 2");
  });

  it("disables the test button until configured, then fires onTest", () => {
    const onTest = jest.fn();
    const { rerender } = render(
      <TelegramNotificationCard
        settings={makeSettings({ telegram_configured: false })}
        onChange={jest.fn()}
        onTest={onTest}
        testing={false}
      />
    );
    expect(screen.getByRole("button", { name: /send test message/i })).toBeDisabled();

    rerender(
      <TelegramNotificationCard
        settings={makeSettings({ telegram_configured: true })}
        onChange={jest.fn()}
        onTest={onTest}
        testing={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /send test message/i }));
    expect(onTest).toHaveBeenCalledWith("telegram");
  });

  it("shows the sending state while a test is in flight", () => {
    render(
      <TelegramNotificationCard
        settings={makeSettings({ telegram_configured: true })}
        onChange={jest.fn()}
        onTest={jest.fn()}
        testing={true}
      />
    );
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
  });
});

describe("EmailNotificationCard", () => {
  it("edits the from-address and fires the email test", () => {
    const onChange = jest.fn();
    const onTest = jest.fn();
    render(
      <EmailNotificationCard
        settings={makeSettings({ notification_email_to: "a@b.com" })}
        onChange={onChange}
        onTest={onTest}
        testing={false}
      />
    );

    fireEvent.change(screen.getByLabelText("From address"), {
      target: { value: "sender@x.com" },
    });
    expect(onChange).toHaveBeenCalledWith("notification_email_from", "sender@x.com");

    fireEvent.click(screen.getByRole("button", { name: /send test email/i }));
    expect(onTest).toHaveBeenCalledWith("email");
  });

  it("edits SMTP fields once the SMTP section is expanded", () => {
    const onChange = jest.fn();
    render(
      <EmailNotificationCard
        settings={makeSettings()}
        onChange={onChange}
        onTest={jest.fn()}
        testing={false}
      />
    );

    fireEvent.click(screen.getByText("SMTP Configuration"));

    fireEvent.change(screen.getByLabelText("SMTP Host"), {
      target: { value: "smtp.gmail.com" },
    });
    expect(onChange).toHaveBeenCalledWith("smtp_host", "smtp.gmail.com");

    fireEvent.change(screen.getByLabelText("SMTP Port"), {
      target: { value: "587" },
    });
    expect(onChange).toHaveBeenCalledWith("smtp_port", 587);

    // Non-numeric port falls back to 0.
    fireEvent.change(screen.getByLabelText("SMTP Port"), {
      target: { value: "abc" },
    });
    expect(onChange).toHaveBeenCalledWith("smtp_port", 0);

    fireEvent.change(screen.getByLabelText("SMTP Username"), {
      target: { value: "me@x.com" },
    });
    expect(onChange).toHaveBeenCalledWith("smtp_user", "me@x.com");

    fireEvent.change(screen.getByLabelText("SMTP Password"), {
      target: { value: "pw" },
    });
    expect(onChange).toHaveBeenCalledWith("smtp_password", "pw");

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith("smtp_use_tls", true);
  });

  it("removes the last email on Backspace and adds one on blur", () => {
    const onChange = jest.fn();
    render(
      <EmailNotificationCard
        settings={makeSettings({ notification_email_to: "keep@x.com" })}
        onChange={onChange}
        onTest={jest.fn()}
        testing={false}
      />
    );

    const input = screen.getByPlaceholderText(/add email/i);

    // Backspace on an empty input removes the last tag (sole email → null).
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith("notification_email_to", null);

    // Typing then blurring commits the email.
    fireEvent.change(input, { target: { value: "new@x.com" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("notification_email_to", "keep@x.com, new@x.com");
  });
});

describe("GeneralNotificationCard", () => {
  it("edits the frequency and the health-check toggle", () => {
    const onChange = jest.fn();
    render(
      <GeneralNotificationCard settings={makeSettings()} onChange={onChange} />
    );

    fireEvent.change(screen.getByLabelText(/notification frequency/i), {
      target: { value: "daily" },
    });
    expect(onChange).toHaveBeenCalledWith("notification_frequency", "daily");

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(
      "health_check_notifications_enabled",
      false
    );
  });
});
