import {
  loadAskSnapshot,
  loadSearchSnapshot,
  saveAskSnapshot,
  saveSearchSnapshot,
  type AskPageSnapshot,
  type SearchPageSnapshot,
} from "@/lib/page-state";

function makeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    length: 0,
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as Storage;
}

describe("page state persistence", () => {
  test("round-trips search snapshot via storage", () => {
    const storage = makeStorage();
    const snapshot: SearchPageSnapshot = {
      query: "vector db",
      submittedQuery: "vector db",
      feedFilter: "feed-123",
      page: 2,
      viewMode: "flat",
    };

    saveSearchSnapshot(snapshot, storage);
    expect(loadSearchSnapshot(storage)).toEqual(snapshot);
  });

  test("round-trips ask snapshot via storage", () => {
    const storage = makeStorage();
    const snapshot: AskPageSnapshot = {
      question: "What was said about latency?",
      answer: "Latency improved by 40%.",
      status: "done",
      errorMsg: "",
      model: "qwen2.5:3b",
      selectedFeedIds: ["feed-1", "__uploads__"],
      helpCoverageSnapshot: { processed: 195, total: 392 },
      sources: [
        {
          chunk_id: 1,
          episode_id: "ep-1",
          episode_title: "Episode 1",
          speaker_label: "HOST",
          start_time: 42,
          end_time: 50,
          timestamp: "0:42",
          text: "Latency improved by 40%.",
          similarity: 0.91,
        },
      ],
    };

    saveAskSnapshot(snapshot, storage);
    expect(loadAskSnapshot(storage)).toEqual(snapshot);
  });

  test("ignores malformed snapshot payloads", () => {
    const storage = makeStorage();
    storage.setItem("podlog-search-page-state", "{broken json");
    storage.setItem("podlog-ask-page-state", "{}");

    expect(loadSearchSnapshot(storage)).toBeNull();
    expect(loadAskSnapshot(storage)).toBeNull();
  });

  test("rejects ask snapshots with malformed helpCoverageSnapshot", () => {
    const storage = makeStorage();
    storage.setItem(
      "podlog-ask-page-state",
      JSON.stringify({
        question: "Q",
        answer: "A",
        sources: [],
        status: "done",
        errorMsg: "",
        model: "qwen2.5:3b",
        selectedFeedIds: [],
        helpCoverageSnapshot: { processed: "bad", total: 100 },
      })
    );

    expect(loadAskSnapshot(storage)).toBeNull();
  });
});
