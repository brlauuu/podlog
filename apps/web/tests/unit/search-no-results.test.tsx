import { render, screen } from "@testing-library/react";
import SearchNoResults from "@/components/SearchNoResults";

describe("<SearchNoResults>", () => {
  it("renders the user's query in curly quotes", () => {
    render(<SearchNoResults query="jazz" />);
    expect(screen.getByText(/No results for/)).toHaveTextContent(
      "No results for \u201Cjazz\u201D"
    );
  });

  it("renders the search-tip line", () => {
    render(<SearchNoResults query="x" />);
    expect(
      screen.getByText(/Try checking your spelling, or use broader search terms\./)
    ).toBeInTheDocument();
  });
});
