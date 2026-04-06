const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-background text-xs text-muted-foreground mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col items-center gap-1">
        <p>
          &copy; 2026{" "}
          <a
            href="https://brlauuu.github.io"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            brlauuu
          </a>
          .{" "}
          <a
            href="https://osaasy.dev"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            O&apos;Saasy License
          </a>
        </p>
        <p>v{APP_VERSION}</p>
      </div>
    </footer>
  );
}
