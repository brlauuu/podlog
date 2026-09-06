import { metadata } from "@/app/layout";

describe("Root layout metadata", () => {
  test("names every page after the app (#1059)", () => {
    expect(metadata.title).toEqual({ default: "Podlog", template: "Podlog | %s" });
  });


  test("defines podlog favicon icon", () => {
    expect(metadata.icons).toEqual({
      icon: "/brand/podlog-favicon.png",
      shortcut: "/brand/podlog-favicon.png",
      apple: "/brand/podlog-favicon.png",
    });
  });
});
