/**
 * @jest-environment node
 */
import { SettingsSchema } from "@/lib/settings-schema";

const validPayload = {
  telegram_bot_token: null,
  telegram_chat_id: null,
  notification_email_to: null,
  notification_email_from: "podlog@example.com",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_user: null,
  smtp_password: null,
  smtp_use_tls: true,
  notification_frequency: "daily",
  health_check_notifications_enabled: true,
  inference_provider: "local",
  fireworks_api_key: null,
  fireworks_audio_base_url: "https://api.fireworks.ai/inference/v1/audio",
  fireworks_stt_model: "whisper-v3-turbo",
  fireworks_stt_diarize: false,
  fireworks_chat_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_chat_model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  fireworks_stt_cost_per_minute_usd: 0.0009,
  embedding_provider: "local",
  embedding_model: "all-MiniLM-L6-v2",
  fireworks_embedding_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_embedding_model: "nomic-ai/nomic-embed-text-v1.5",
  diarization_provider: "local",
  pyannote_api_key: null,
  pyannote_cloud_base_url: "https://api.pyannote.ai/v1",
  pyannote_cloud_model: "precision-2",
  pyannote_model: "pyannote/speaker-diarization-community-1",
  pyannote_cloud_cost_per_second_usd: 0.0006,
  rag_provider: "local",
  rag_local_model: "qwen2.5:3b",
  telegram_configured: false,
  email_configured: false,
  fireworks_configured: false,
  pyannote_cloud_configured: false,
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
    const result = SettingsSchema.safeParse({ ...validPayload, fireworks_api_key: null });
    expect(result.success).toBe(true);
  });

  it("accepts a string for nullable secret fields", () => {
    const result = SettingsSchema.safeParse({
      ...validPayload,
      fireworks_api_key: "fw_test_key",
    });
    expect(result.success).toBe(true);
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
