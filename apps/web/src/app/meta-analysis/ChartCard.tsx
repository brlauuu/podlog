"use client";

import { useState, ReactNode } from "react";
import ExpandModal from "./ExpandModal";

interface Props {
  title: string;
  subtitle?: string;
  coverage?: { included: number; total: number; onClickExcluded?: () => void };
  children: ReactNode;         // the chart itself
  detail?: ReactNode;          // optional bigger/table view for the expand modal
}

export default function ChartCard({ title, subtitle, coverage, children, detail }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="border rounded-md p-4 bg-background">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {detail && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Expand"
            >
              <span aria-hidden="true">⛶</span>
            </button>
          )}
        </div>

        <div className="mt-3">{children}</div>

        {coverage && (
          <div className="mt-3 text-xs text-muted-foreground">
            {coverage.included} / {coverage.total} episodes
            {coverage.total > coverage.included && coverage.onClickExcluded && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={coverage.onClickExcluded}
                  className="underline-offset-2 hover:underline"
                >
                  {coverage.total - coverage.included} excluded ▸
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <ExpandModal open={expanded} onClose={() => setExpanded(false)} title={title}>
        {detail ?? children}
      </ExpandModal>
    </>
  );
}
