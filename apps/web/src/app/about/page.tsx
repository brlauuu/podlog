import { ExternalLink } from "lucide-react";

const TECH_STACK = [
  { name: "WhisperX", url: "https://github.com/m-bain/whisperX" },
  { name: "faster-whisper", url: "https://github.com/SYSTRAN/faster-whisper" },
  { name: "pyannote", url: "https://github.com/pyannote/pyannote-audio" },
  { name: "Next.js", url: "https://nextjs.org" },
  { name: "PostgreSQL", url: "https://www.postgresql.org" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com" },
];

const CREDITS = [
  { name: "@brlauuu", url: "https://github.com/brlauuu", label: "Author" },
];

const AGENTS = [
  { name: "Claude", url: "https://claude.ai", label: " Anthropic" },
  { name: "Gemini", url: "https://gemini.google.com", label: " Google" },
  { name: "OpenCode", url: "https://opencode.ai", label: " Kimi K2.5" },
];

const PLATFORMS = [
  { name: "Omnara", url: "https://omnara.cc" },
  { name: "Fireworks AI", url: "https://fireworks.ai", label: " (optional remote inference)" },
];

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 py-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">About Podlog</h1>
        <p className="text-muted-foreground">
          Podlog is a self-hosted podcast transcription and search application.
          It downloads episodes from RSS feeds, transcribes them locally using
          Whisper, identifies speakers with pyannote, and provides full-text and
          semantic search across all your transcripts.
        </p>
        <p className="text-muted-foreground">
          Everything runs on your hardware. No audio leaves your machine, no
          transcripts are sent to external services, and no telemetry is
          collected.
        </p>
      </div>

      {/* Blog placeholder */}
      <div className="rounded-lg border border-border p-4 space-y-1">
        <p className="text-sm font-medium">Read more</p>
        <p className="text-sm text-muted-foreground">
          A blog post covering the motivation behind Podlog is coming soon.
        </p>
      </div>

      {/* Credits */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Credits</h2>
        <p className="text-sm text-muted-foreground">
          Built by{" "}
          {CREDITS.map((credit, i) => (
            <a
              key={credit.name}
              href={credit.url}
              className="underline hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              {credit.name}
            </a>
          ))}
          {" with support from:"}
        </p>

        <div className="text-sm">
          <p className="font-medium text-muted-foreground">Agents</p>
          <ul className="list-disc list-inside space-y-0.5">
            {AGENTS.map((agent) => (
              <li key={agent.name}>
                <a
                  href={agent.url}
                  className="underline hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {agent.name}
                </a>
                {agent.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="text-sm">
          <p className="font-medium text-muted-foreground">Platforms</p>
          <ul className="list-disc list-inside space-y-0.5">
            {PLATFORMS.map((platform) => (
              <li key={platform.name}>
                <a
                  href={platform.url}
                  className="underline hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {platform.name}
                </a>
                {platform.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground PT-2">
          <ExternalLink size={13} />
          <a
            href="https://github.com/brlauuu/podlog"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            brlauuu/podlog
          </a>
          {" · "}
          <a
            href="https://osaasy.dev"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            O&apos;Saasy License
          </a>
        </div>
      </div>

      {/* Built with */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Built with</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {TECH_STACK.map((tech, i) => (
            <span key={tech.name}>
              <a
                href={tech.url}
                className="underline hover:text-foreground"
                target="_blank"
                rel="noopener noreferrer"
              >
                {tech.name}
              </a>
              {i < TECH_STACK.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
      </div>

      {/* Privacy */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <p className="text-sm text-muted-foreground">
          All data stays on your machine. Audio files, transcripts, and
          embeddings are stored locally. No external APIs are called during
          transcription or search. The only outbound requests are RSS feed
          fetches to download episode metadata and audio.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Disclaimer</h2>
        <p className="text-sm text-muted-foreground">
          This software is an open-source tool for audio transcription. It
          does not include any copyrighted content. Users are responsible for
          ensuring their use of the software complies with local copyright laws
          and the Terms of Service of any content creators whose work they
          process.
        </p>
      </div>
    </div>
  );
}
