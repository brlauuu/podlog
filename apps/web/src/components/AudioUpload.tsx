"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, FileAudio, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ALLOWED_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/flac",
  "audio/opus", "audio/aac", "audio/x-m4a", "audio/webm", "audio/x-wav",
  "video/mp4",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".opus", ".aac", ".wma", ".webm", ".mp4",
]);

function isValidAudio(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function defaultTitle(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return stem.replace(/[_-]/g, " ");
}

interface AudioUploadProps {
  onUploaded?: (episodeId: string) => void;
}

export default function AudioUpload({ onUploaded }: AudioUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setError(null);
    setSuccess(null);
    if (!isValidAudio(f)) {
      setError(`Unsupported file type. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`);
      return;
    }
    setFile(f);
    setTitle(defaultTitle(f.name));
    setDescription("");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const handleSubmit = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title.trim());
    formData.append("description", description.trim());

    try {
      const resp = await fetch("/api/episodes/upload", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();

      if (!resp.ok) {
        setError(data.detail || "Upload failed");
        return;
      }

      setSuccess("Upload successful — episode queued for processing");
      setFile(null);
      setTitle("");
      setDescription("");
      onUploaded?.(data.episode_id);
    } catch {
      setError("Upload failed — check your connection");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    setFile(null);
    setTitle("");
    setDescription("");
    setError(null);
    setSuccess(null);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/mp4,.mp4"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop an audio file here, or click to browse
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            MP3, M4A, MP4, WAV, OGG, FLAC, OPUS, AAC, WebM
          </p>
        </div>

        {/* Selected file + metadata form */}
        {file && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <FileAudio size={16} className="text-muted-foreground shrink-0" />
              <span className="truncate">{file.name}</span>
              <span className="text-muted-foreground shrink-0">
                ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </span>
              <button onClick={clear} className="ml-auto text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Episode title"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notes about this audio file..."
                rows={3}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <Button onClick={handleSubmit} disabled={uploading} className="w-full">
              {uploading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload and process"
              )}
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        )}
      </CardContent>
    </Card>
  );
}
