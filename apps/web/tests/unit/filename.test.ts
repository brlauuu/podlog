/**
 * @jest-environment node
 *
 * Covers issue #537: non-ASCII letters like đ/Đ/ć/č/š/ž must survive
 * export filename sanitization instead of being replaced with "_".
 */
import { sanitizeFilename } from "@/lib/filename";

describe("sanitizeFilename", () => {
  describe("unicode preservation (issue #537)", () => {
    test("preserves Latin Extended letters (đ, Đ, ć, č, š, ž)", () => {
      expect(sanitizeFilename("Đorđe")).toBe("Đorđe");
      expect(sanitizeFilename("Relić")).toBe("Relić");
      expect(sanitizeFilename("čšž")).toBe("čšž");
    });

    test("preserves case (does not force lowercase)", () => {
      expect(sanitizeFilename("Đorđe Relić")).toBe("Đorđe-Relić");
    });

    test("preserves accented Latin letters", () => {
      expect(sanitizeFilename("Café résumé naïve")).toBe("Café-résumé-naïve");
    });

    test("preserves non-Latin scripts", () => {
      expect(sanitizeFilename("日本語タイトル")).toBe("日本語タイトル");
      expect(sanitizeFilename("Русский заголовок")).toBe("Русский-заголовок");
    });
  });

  describe("filesystem-reserved character stripping", () => {
    test("strips Windows-reserved characters", () => {
      expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    });

    test("strips ASCII control characters", () => {
      expect(sanitizeFilename("foo\x00\x01\x1fbar")).toBe("foobar");
    });

    test("preserves common safe punctuation", () => {
      expect(sanitizeFilename("Episode #12 (part 1) - final")).toBe(
        "Episode-#12-(part-1)-final",
      );
      expect(sanitizeFilename("A & B's discussion")).toBe("A-&-B's-discussion");
    });
  });

  describe("whitespace collapsing", () => {
    test("collapses runs of whitespace to a single separator", () => {
      expect(sanitizeFilename("a   b\tc\n\nd")).toBe("a-b-c-d");
    });

    test("honors custom separator", () => {
      expect(sanitizeFilename("a b c", { separator: "_" })).toBe("a_b_c");
    });
  });

  describe("edge trimming", () => {
    test("trims leading and trailing dots and spaces", () => {
      expect(sanitizeFilename("  ...hello...  ")).toBe("hello");
    });

    test("trims leading and trailing separators", () => {
      expect(sanitizeFilename(" hello ")).toBe("hello");
      expect(sanitizeFilename("---hello---")).toBe("hello");
    });

    test("re-trims after truncation to avoid trailing separator", () => {
      // "Hello World!" → collapsed to "Hello-World!" (12 chars)
      // Slice to 6 → "Hello-" → trimmed → "Hello"
      expect(sanitizeFilename("Hello World!", { maxLength: 6 })).toBe("Hello");
    });
  });

  describe("truncation", () => {
    test("truncates by code points, not UTF-16 code units", () => {
      // Each emoji is a surrogate pair (2 UTF-16 code units). With a naive
      // .slice(0, N) on strings, truncating between halves would corrupt the
      // output. Array.from splits by code points, giving us safe truncation.
      const eight = "🎙️".repeat(8);
      const result = sanitizeFilename(eight, { maxLength: 4 });
      // The variation selector (U+FE0F) is a separate code point from the
      // microphone, so 4 code points = 2 full emoji glyphs.
      expect(Array.from(result).length).toBe(4);
    });

    test("default maxLength is 100", () => {
      const long = "a".repeat(200);
      expect(sanitizeFilename(long).length).toBe(100);
    });

    test("respects custom maxLength", () => {
      expect(sanitizeFilename("abcdefghij", { maxLength: 5 })).toBe("abcde");
    });
  });

  describe("fallback", () => {
    test("returns default fallback when input is empty", () => {
      expect(sanitizeFilename("")).toBe("untitled");
    });

    test("returns default fallback when input is whitespace only", () => {
      expect(sanitizeFilename("   ")).toBe("untitled");
    });

    test("returns default fallback when input is only reserved chars", () => {
      expect(sanitizeFilename('/\\:*?"<>|')).toBe("untitled");
    });

    test("honors custom fallback", () => {
      expect(sanitizeFilename("", { fallback: "episode" })).toBe("episode");
    });
  });

  describe("unicode normalization", () => {
    test("normalizes to NFC form", () => {
      // "é" can be encoded as a single char (U+00E9) or as e + combining
      // acute accent (U+0065 U+0301). NFC canonicalizes to the composed form.
      const decomposed = "e\u0301";
      const composed = "\u00e9";
      expect(sanitizeFilename(decomposed)).toBe(composed);
    });
  });
});
