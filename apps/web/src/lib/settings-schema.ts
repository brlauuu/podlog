import { z } from "zod";

/**
 * Runtime schema for the settings payload returned by
 * `GET /api/notifications/settings`. The shape must stay in lockstep with
 * the backend allowlist:
 *
 *   apps/pipeline/app/services/notification_settings.py::_FIELDS
 *   (+ _NULLABLE_FIELDS, _VALID_FREQUENCIES, _VALID_INFERENCE_PROVIDERS,
 *      _VALID_EMBEDDING_PROVIDERS, _VALID_DIARIZATION_PROVIDERS)
 *
 * The pipeline is the source of truth. If a new field is added there, mirror
 * it here. Drift is caught at runtime when the Settings page parses the
 * response — the page surfaces a clear error rather than silently using a
 * mistyped shape (which previously could corrupt the DB on a follow-up PUT
 * because /api/notifications/settings is a thin proxy that forwards arbitrary
 * JSON to the backend).
 */
export const SettingsSchema = z.object({
  // Nullable string fields (mirror _NULLABLE_FIELDS).
  telegram_bot_token: z.string().nullable(),
  telegram_chat_id: z.string().nullable(),
  notification_email_to: z.string().nullable(),
  smtp_user: z.string().nullable(),
  smtp_password: z.string().nullable(),
  fireworks_api_key: z.string().nullable(),
  pyannote_api_key: z.string().nullable(),

  // Required string fields.
  notification_email_from: z.string(),
  smtp_host: z.string(),
  fireworks_audio_base_url: z.string(),
  fireworks_stt_model: z.string(),
  fireworks_chat_base_url: z.string(),
  fireworks_chat_model: z.string(),
  embedding_model: z.string(),
  fireworks_embedding_base_url: z.string(),
  fireworks_embedding_model: z.string(),
  pyannote_cloud_base_url: z.string(),
  pyannote_cloud_model: z.string(),

  // Numbers.
  smtp_port: z.number(),
  fireworks_stt_cost_per_minute_usd: z.number(),
  pyannote_cloud_cost_per_second_usd: z.number(),

  // Booleans.
  smtp_use_tls: z.boolean(),
  health_check_notifications_enabled: z.boolean(),
  fireworks_stt_diarize: z.boolean(),

  // Enums (mirror backend _VALID_* sets).
  notification_frequency: z.enum(["immediate", "daily", "weekly"]),
  inference_provider: z.enum(["local", "fireworks"]),
  embedding_provider: z.enum(["local", "fireworks"]),
  diarization_provider: z.enum(["local", "precision2"]),

  // Server-computed read-only flags. Not in _FIELDS but always present in
  // the response payload — derived booleans the API includes alongside
  // writable settings.
  telegram_configured: z.boolean(),
  email_configured: z.boolean(),
  fireworks_configured: z.boolean(),
  pyannote_cloud_configured: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;
