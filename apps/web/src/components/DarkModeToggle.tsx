"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const STORAGE_KEY = "podlog-theme";

/**
 * Dark mode toggle — lightbulb style matching brlauuu.github.io.
 * Persists preference to localStorage (PRD-02 §5.8).
 */
export default function DarkModeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const prefersDark =
      stored === "dark" ||
      (stored === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(prefersDark);
    document.documentElement.classList.toggle("dark", prefersDark);
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  }

  // Prevent flash of wrong icon on SSR
  if (!mounted) {
    return <div className="w-[18px] h-[18px]" />;
  }

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="hover:scale-[1.15] active:scale-95 transition-transform duration-200"
    >
      <Image
        src={dark ? "/imgs/lightbulb-off.png" : "/imgs/lightbulb-on.png"}
        alt={dark ? "Dark mode" : "Light mode"}
        width={18}
        height={18}
        className="select-none"
      />
    </button>
  );
}
