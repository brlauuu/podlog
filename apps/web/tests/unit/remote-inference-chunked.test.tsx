/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineStepCards } from "@/components/RemoteInferenceSectionParts";
import type { Settings } from "@/lib/settings-schema";
import type { HardwareInfo } from "@/components/RemoteInferenceSectionParts";

const baseSettings: Settings = {
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
  inference_provider: "fireworks", // remote transcription enabled
  fireworks_api_key: "fw_key",
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
  diarization_provider: "local",
  pyannote_api_key: null,
  pyannote_cloud_base_url: "https://api.pyannote.ai/v1",
  pyannote_cloud_model: "precision-2",
  pyannote_cloud_cost_per_second_usd: 0,
  fireworks_chunked_transcription_enabled: false,
  fireworks_chunk_target_secs: 900,
  fireworks_chunk_overlap_secs: 3,
  fireworks_chunk_max_retries: 2,
  telegram_configured: false,
  email_configured: false,
  fireworks_configured: true,
  pyannote_cloud_configured: false,
};

const noopHwInfo: HardwareInfo | null = null;

describe("Transcription chunked transcription UI (#610 PR 4)", () => {
  it("hides the chunked toggle when transcription is on local", () => {
    const localSettings = { ...baseSettings, inference_provider: "local" as const };
    render(
      <PipelineStepCards
        settings={localSettings}
        hwInfo={noopHwInfo}
        onChange={jest.fn()}
        onRequireApiKey={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText(/chunk long episodes/i)).toBeNull();
  });

  it("shows the chunked toggle when transcription is on Fireworks", () => {
    render(
      <PipelineStepCards
        settings={baseSettings}
        hwInfo={noopHwInfo}
        onChange={jest.fn()}
        onRequireApiKey={jest.fn()}
      />,
    );
    expect(screen.getByLabelText(/chunk long episodes/i)).toBeInTheDocument();
  });

  it("does not show advanced tunables until the toggle is enabled", () => {
    render(
      <PipelineStepCards
        settings={baseSettings}
        hwInfo={noopHwInfo}
        onChange={jest.fn()}
        onRequireApiKey={jest.fn()}
      />,
    );
    expect(screen.queryByText(/advanced tunables/i)).toBeNull();
  });

  it("reveals the advanced tunables when the toggle is enabled", () => {
    const enabledSettings = {
      ...baseSettings,
      fireworks_chunked_transcription_enabled: true,
    };
    render(
      <PipelineStepCards
        settings={enabledSettings}
        hwInfo={noopHwInfo}
        onChange={jest.fn()}
        onRequireApiKey={jest.fn()}
      />,
    );
    expect(screen.getByText(/advanced tunables/i)).toBeInTheDocument();
  });

  it("emits onChange with the correct field when toggling", () => {
    const onChange = jest.fn();
    render(
      <PipelineStepCards
        settings={baseSettings}
        hwInfo={noopHwInfo}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />,
    );
    const toggle = screen.getByLabelText(/chunk long episodes/i);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(
      "fireworks_chunked_transcription_enabled",
      true,
    );
  });

  it("emits onChange with parsed integer when editing chunk size", () => {
    const onChange = jest.fn();
    const enabledSettings = {
      ...baseSettings,
      fireworks_chunked_transcription_enabled: true,
    };
    render(
      <PipelineStepCards
        settings={enabledSettings}
        hwInfo={noopHwInfo}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />,
    );
    // Open the collapsible by clicking its trigger.
    fireEvent.click(screen.getByText(/advanced tunables/i));
    const sizeInput = screen.getByLabelText(/chunk size/i) as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: "720" } });
    expect(onChange).toHaveBeenCalledWith("fireworks_chunk_target_secs", 720);
  });

  it("ignores below-min values for chunk size", () => {
    const onChange = jest.fn();
    const enabledSettings = {
      ...baseSettings,
      fireworks_chunked_transcription_enabled: true,
    };
    render(
      <PipelineStepCards
        settings={enabledSettings}
        hwInfo={noopHwInfo}
        onChange={onChange}
        onRequireApiKey={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/advanced tunables/i));
    const sizeInput = screen.getByLabelText(/chunk size/i) as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: "30" } }); // below 60
    // Should NOT have been called with 30.
    const calls = onChange.mock.calls.filter(
      (c) => c[0] === "fireworks_chunk_target_secs",
    );
    expect(calls).toEqual([]);
  });
});
