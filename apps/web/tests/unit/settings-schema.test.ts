/**
 * @jest-environment node
 */
import { SettingsSchema } from "@/lib/settings-schema";

const validPayload = {
  telegram_bot_token: null,
  telegram_chat_id: null,
  telegram_allowed_user_ids: null,
  notification_email_to: null,
  notification_email_from: "podlog@example.com",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_user: null,
  smtp_password: null,
  smtp_use_tls: true,
  notification_frequency: "daily",
  health_check_notifications_enabled: true,
  embedding_model: "all-MiniLM-L6-v2",
  pyannote_model: "pyannote/speaker-diarization-community-1",
  rag_local_model: "qwen2.5:3b",
  telegram_configured: false,
  email_configured: false,
};

describe("SettingsSchema", () => {
  it("accepts a known-good payload", () => {
    const result = SettingsSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    const { smtp_host: _omitted, ...rest } = validPayload;
    const result = SettingsSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("smtp_host"))).toBe(true);
    }
  });

  it("rejects when a field has the wrong type (string instead of number)", () => {
    const result = SettingsSchema.safeParse({ ...validPayload, smtp_port: "587" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("smtp_port"))).toBe(true);
    }
  });

  it("rejects an enum value outside the allowed set", () => {
    const result = SettingsSchema.safeParse({ ...validPayload, notification_frequency: "hourly" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes("notification_frequency")),
      ).toBe(true);
    }
  });

  it("rejects when a non-nullable string is null", () => {
    const result = SettingsSchema.safeParse({ ...validPayload, smtp_host: null });
    expect(result.success).toBe(false);
  });

  it("accepts null for nullable secret fields", () => {
    const result = SettingsSchema.safeParse({ ...validPayload, smtp_password: null });
    expect(result.success).toBe(true);
  });

  it("accepts a string for nullable secret fields", () => {
    const result = SettingsSchema.safeParse({
      ...validPayload,
      smtp_password: "secret",
    });
    expect(result.success).toBe(true);
  });

  // #1092: an older pipeline still answering with the remote keys must not
  // break the page during an upgrade.
  it("ignores the retired remote-inference keys", () => {
    const result = SettingsSchema.safeParse({
      ...validPayload,
      inference_provider: "fireworks",
      fireworks_api_key: "fw_x",
      pyannote_cloud_configured: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("fireworks_api_key" in result.data).toBe(false);
    }
  });

  it("strips unknown keys (additive backend changes don't break the page)", () => {
    const result = SettingsSchema.safeParse({ ...validPayload, _unknown_future_field: 42 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as unknown as Record<string, unknown>)._unknown_future_field,
      ).toBeUndefined();
    }
  });
});
