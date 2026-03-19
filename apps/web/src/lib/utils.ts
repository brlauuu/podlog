import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Client-safe path basename (no Node.js path module needed). */
export function basename(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
