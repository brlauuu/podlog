import pool from "@/lib/db";
import type { EpisodeCoverage } from "@/lib/search/types";

type CoverageRow = { processed: number; total: number };
type CoverageQueryResult = { rows: Array<CoverageRow> } | null;

export function buildCoverage(skipCount: boolean): Promise<CoverageQueryResult> {
  if (skipCount) return Promise.resolve(null);
  return pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'done')::int AS processed,
      COUNT(*)::int AS total
    FROM episodes`
  );
}

export function toCoverage(coverageResult: CoverageQueryResult): EpisodeCoverage {
  const cov = coverageResult?.rows[0];
  return {
    processed: cov?.processed ?? 0,
    total: cov?.total ?? 0,
  };
}
