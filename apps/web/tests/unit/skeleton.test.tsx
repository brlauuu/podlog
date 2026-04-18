import { render } from "@testing-library/react";
import { Skeleton } from "@/components/ui/skeleton";

describe("<Skeleton>", () => {
  it("renders a div with default animate-pulse classes", () => {
    const { container } = render(<Skeleton data-testid="sk" />);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("rounded-md");
    expect(el.className).toContain("bg-muted");
  });

  it("merges custom className with defaults", () => {
    const { container } = render(<Skeleton className="w-10 h-4" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("w-10");
    expect(el.className).toContain("h-4");
    expect(el.className).toContain("animate-pulse");
  });

  it("forwards extra props (e.g. aria-label) to the underlying div", () => {
    const { container } = render(<Skeleton aria-label="loading" role="status" />);
    const el = container.firstChild as HTMLElement;
    expect(el.getAttribute("aria-label")).toBe("loading");
    expect(el.getAttribute("role")).toBe("status");
  });
});
