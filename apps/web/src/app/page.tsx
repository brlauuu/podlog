import Link from "next/link";
import Image from "next/image";
import { Search, BrainCircuit, Book } from "lucide-react";

export default function HomePage() {
  return (
    <div className="my-auto flex flex-col items-center space-y-8">
      {/* Title + tagline */}
      <div className="text-center space-y-3">
        <Image
          src="/brand/podlog-logo-light-theme.svg"
          alt="Podlog"
          width={970}
          height={320}
          priority
          className="h-auto w-[280px] sm:w-[420px] block dark:hidden"
        />
        <Image
          src="/brand/podlog-logo-dark-theme.svg"
          alt="Podlog"
          width={970}
          height={320}
          priority
          className="h-auto w-[280px] sm:w-[420px] hidden dark:block"
        />
        <p className="text-lg text-muted-foreground max-w-md mx-auto">
          Your self-hosted transcription database.
        </p>
      </div>

      {/* Quick links — width pinned to logo so three buttons don't outgrow it.
          #989: was a fixed w-[280px]. flex-1 children default to
          min-width:auto, so when their min-content width (icon + label +
          px-5) exceeded a third of 280px they overflowed the page instead of
          shrinking. Now it is a max-width, and the children may shrink. */}
      <div className="flex gap-2 sm:gap-4 w-full max-w-[280px] sm:max-w-[420px]">
        <Link
          href="/search"
          className="flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors"
        >
          <Search size={16} />
          Search
        </Link>
        <Link
          href="/ask"
          className="flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors"
        >
          <BrainCircuit size={16} />
          Ask
        </Link>
        <Link
          href="/podcasts"
          className="flex-1 min-w-0 inline-flex items-center justify-center gap-2 px-3 sm:px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors"
        >
          <Book size={16} />
          Explore
        </Link>
      </div>
    </div>
  );
}
