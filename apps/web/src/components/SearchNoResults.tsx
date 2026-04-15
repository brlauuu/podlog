interface SearchNoResultsProps {
  query: string;
}

export default function SearchNoResults({ query }: SearchNoResultsProps) {
  return (
    <div className="text-center py-16 space-y-2">
      <p className="text-muted-foreground">
        No results for &ldquo;{query}&rdquo;
      </p>
      <p className="text-sm text-muted-foreground">
        Try checking your spelling, or use broader search terms.
      </p>
    </div>
  );
}
