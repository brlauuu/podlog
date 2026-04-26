"use client";

// `Settings` is defined by the Zod schema in @/lib/settings-schema so the
// runtime parse and the compile-time type cannot drift from each other.
// Re-exported here to keep existing imports stable across the codebase.
export type { Settings } from "@/lib/settings-schema";

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
