"use client";

interface SearchSpinnerProps {
  label: string;
}

export default function SearchSpinner({ label }: SearchSpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-4 min-h-16">
      <div className="flex items-center gap-0.5 h-6">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span
            key={i}
            className="w-1 h-6 origin-center rounded-full bg-foreground animate-[eqBar_1.4s_ease-in-out_infinite]"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
