"use client";

interface Feed { feed_id: string; title: string; }

interface Props {
  feeds: Feed[];
  selectedFeedIds: string[];
  onSelectedChange: (ids: string[]) => void;
}

export default function FiltersBar({ feeds, selectedFeedIds, onSelectedChange }: Props) {
  const toggle = (id: string) => {
    if (selectedFeedIds.includes(id)) {
      onSelectedChange(selectedFeedIds.filter((x) => x !== id));
    } else {
      onSelectedChange([...selectedFeedIds, id]);
    }
  };
  const all = selectedFeedIds.length === 0;

  return (
    <div className="flex flex-wrap gap-2 items-center text-sm border rounded-md p-2 bg-muted/30">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Filter
      </span>
      <button
        type="button"
        onClick={() => onSelectedChange([])}
        className={`px-2 py-1 rounded ${all ? "bg-accent" : "hover:bg-accent"}`}
      >
        All podcasts
      </button>
      {feeds.map((f) => (
        <label
          key={f.feed_id}
          className="flex items-center gap-1 cursor-pointer px-2 py-1 rounded hover:bg-accent"
        >
          <input
            type="checkbox"
            checked={selectedFeedIds.includes(f.feed_id)}
            onChange={() => toggle(f.feed_id)}
          />
          {f.title}
        </label>
      ))}
    </div>
  );
}
