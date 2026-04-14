"use client";

import { Layers, List } from "lucide-react";
import DownloadReportButton from "@/components/DownloadReportButton";
import type { SearchPage as SearchPageType, GroupedSearchResult } from "@/lib/search";

type ViewMode = "grouped" | "flat";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export default function SearchResultsToolbar({
  viewMode,
  onViewModeChange,
  pageSize,
  onPageSizeChange,
  summaryText,
  coverageText,
  submittedQuery,
  flatData,
  groupedData,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  summaryText: string;
  coverageText: string | null;
  submittedQuery: string;
  flatData: SearchPageType | undefined;
  groupedData: GroupedSearchResult | undefined;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        {summaryText}
        {coverageText}
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>Per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              onPageSizeChange(next);
            }}
            className="bg-background border border-input rounded-md px-2 py-1 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <DownloadReportButton
          query={submittedQuery}
          viewMode={viewMode}
          flatResults={viewMode === "flat" ? flatData?.results : undefined}
          groupedResults={viewMode === "grouped" ? groupedData : undefined}
        />
        <div className="flex items-center border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => onViewModeChange("grouped")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
              viewMode === "grouped"
                ? "bg-action text-action-foreground"
                : "hover:bg-accent/30"
            }`}
            title="Grouped view"
          >
            <Layers size={13} />
            Grouped
          </button>
          <button
            onClick={() => onViewModeChange("flat")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
              viewMode === "flat"
                ? "bg-action text-action-foreground"
                : "hover:bg-accent/30"
            }`}
            title="Flat view"
          >
            <List size={13} />
            Flat
          </button>
        </div>
      </div>
    </div>
  );
}
