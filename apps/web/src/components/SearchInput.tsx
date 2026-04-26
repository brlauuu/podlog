"use client";

import { type ReactNode, type FormEvent } from "react";
import { X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onClear: () => void;
  placeholder?: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Optional slot rendered on the right side (e.g. submit arrow for Ask) */
  rightSlot?: ReactNode;
  autoFocus?: boolean;
}

export default function SearchInput({
  value,
  onChange,
  onSubmit,
  onClear,
  placeholder = "Search...",
  icon,
  disabled = false,
  rightSlot,
  autoFocus = true,
}: SearchInputProps) {
  return (
    <form onSubmit={onSubmit}>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-16 py-3 text-left border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring text-base transition-shadow"
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
          {rightSlot}
        </div>
      </div>
    </form>
  );
}
