import { metadata } from "@/app/layout";

describe("Root layout metadata", () => {
  test("defines podlog favicon icon", () => {
    expect(metadata.icons).toEqual({
      icon: "/brand/podlog-favicon.png",
      shortcut: "/brand/podlog-favicon.png",
      apple: "/brand/podlog-favicon.png",
    });
  });
});
