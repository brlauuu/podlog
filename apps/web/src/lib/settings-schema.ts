import { z } from "zod";

/**
 * Runtime schema for the settings payload returned by
 * `GET /api/notifications/settings`. The shape must stay in lockstep with
 * the backend allowlist:
 *
 *   apps/pipeline/app/services/notification_settings.py::_FIELDS
 *   (+ _NULLABLE_FIELDS, _VALID_FREQUENCIES)
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
  telegram_allowed_user_ids: z.string().nullable(),
  notification_email_to: z.string().nullable(),
  smtp_user: z.string().nullable(),
  smtp_password: z.string().nullable(),

  // Required string fields.
  notification_email_from: z.string(),
  smtp_host: z.string(),
  embedding_model: z.string(),
  pyannote_model: z.string(),
  rag_local_model: z.string(),

  // Numbers.
  smtp_port: z.number(),

  // Booleans.
  smtp_use_tls: z.boolean(),
  health_check_notifications_enabled: z.boolean(),

  // Enums (mirror backend _VALID_* sets).
  notification_frequency: z.enum(["immediate", "daily", "weekly"]),

  // Server-computed read-only flags. Not in _FIELDS but always present in
  // the response payload — derived booleans the API includes alongside
  // writable settings.
  telegram_configured: z.boolean(),
  email_configured: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;
