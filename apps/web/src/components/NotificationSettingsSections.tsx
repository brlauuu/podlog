"use client";

export interface Settings {
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notification_email_to: string | null;
  notification_email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_use_tls: boolean;
  notification_frequency: string;
  health_check_notifications_enabled: boolean;
  inference_provider: "local" | "fireworks";
  fireworks_api_key: string | null;
  fireworks_audio_base_url: string;
  fireworks_stt_model: string;
  fireworks_stt_diarize: boolean;
  fireworks_chat_base_url: string;
  fireworks_chat_model: string;
  fireworks_stt_cost_per_minute_usd: number;
  embedding_provider: "local" | "fireworks";
  embedding_model: string;
  fireworks_embedding_base_url: string;
  fireworks_embedding_model: string;
  telegram_configured: boolean;
  email_configured: boolean;
  fireworks_configured: boolean;
}

export function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white shadow-lg ${
        type === "success" ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {type === "success" ? "OK" : "X"} {message}
    </div>
  );
}
