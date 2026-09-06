import rehypeStripHead from "@/lib/rehypeStripHead";

type Node = { type: string; tagName?: string; value?: string; children?: Node[] };
const el = (tagName: string, ...children: Node[]): Node => ({ type: "element", tagName, children });
const text = (value: string): Node => ({ type: "text", value });

describe("rehypeStripHead (#1059)", () => {
  it("removes title, meta, link, style, script and base wherever they appear", () => {
    const tree: Node = {
      type: "root",
      children: [
        el("p", text("Added "), el("title", text("this would rename the tab")), text(" or the reason")),
        el("div", el("meta"), el("link"), el("style", text("p{}")), el("script", text("x")), el("base")),
        el("h2", text("kept")),
      ],
    };
    rehypeStripHead()(tree);
    const p = tree.children![0];
    expect(p.children!.map((c) => c.type)).toEqual(["text", "text"]);
    expect(tree.children![1].children).toEqual([]);
    expect(tree.children![2].tagName).toBe("h2");
  });

  it("leaves ordinary elements and text alone, including nested ones", () => {
    const tree: Node = { type: "root", children: [el("ul", el("li", el("code", text("<title>"))))] };
    const before = JSON.stringify(tree);
    rehypeStripHead()(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});
