import { render, screen, fireEvent } from "@testing-library/react";
import ChangelogToc from "@/components/ChangelogToc";

const SAMPLE = [
  { id: "unreleased", text: "[Unreleased]" },
  { id: "0-3-0-2026-04-24", text: "[0.3.0] — 2026-04-24" },
  { id: "0-2-0-2026-04-24", text: "[0.2.0] — 2026-04-24" },
];

describe("<ChangelogToc>", () => {
  it("renders nothing when there are no versions", () => {
    const { container } = render(<ChangelogToc items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one anchor per version, in order", () => {
    render(<ChangelogToc items={SAMPLE} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "[Unreleased]",
      "[0.3.0] — 2026-04-24",
      "[0.2.0] — 2026-04-24",
    ]);
    expect(links[0]).toHaveAttribute("href", "#unreleased");
    expect(links[1]).toHaveAttribute("href", "#0-3-0-2026-04-24");
  });

  it("shows version count and the latest tagged release in the header", () => {
    render(<ChangelogToc items={SAMPLE} />);
    expect(screen.getByText("Releases")).toBeInTheDocument();
    // 3 versions, latest is the first non-Unreleased entry, with the date stripped.
    expect(
      screen.getByText("3 versions · latest [0.3.0]")
    ).toBeInTheDocument();
  });

  it("uses singular when there is only one version", () => {
    render(<ChangelogToc items={[SAMPLE[1]]} />);
    expect(screen.getByText("1 version · latest [0.3.0]")).toBeInTheDocument();
  });

  it("omits the latest hint when only [Unreleased] exists", () => {
    render(<ChangelogToc items={[SAMPLE[0]]} />);
    // No "latest …" suffix because there's no tagged release yet.
    expect(screen.getByText("1 version")).toBeInTheDocument();
  });

  it("highlights the active version on scroll", () => {
    // Mount stub headings the scroll-spy can find.
    document.body.innerHTML = `
      <h2 id="unreleased">A</h2>
      <h2 id="0-3-0-2026-04-24">B</h2>
    `;
    document.body.appendChild(document.createElement("div"));

    // Stub getBoundingClientRect: first heading scrolled past the offset, second still below.
    const stub = (top: number) => ({
      top,
      bottom: top + 20,
      height: 20,
      width: 100,
      left: 0,
      right: 100,
      x: 0,
      y: top,
      toJSON: () => ({}),
    });
    const map: Record<string, number> = {
      unreleased: 50, // 50 - 120 ≤ 0 → active
      "0-3-0-2026-04-24": 500, // 500 - 120 > 0 → not yet active
    };
    for (const id of Object.keys(map)) {
      const el = document.getElementById(id) as HTMLElement;
      el.getBoundingClientRect = () => stub(map[id]);
    }

    render(<ChangelogToc items={SAMPLE} />);
    fireEvent.scroll(window);

    const unreleasedLink = screen.getByRole("link", { name: "[Unreleased]" });
    expect(unreleasedLink.className).toMatch(/font-medium/);
  });
});
