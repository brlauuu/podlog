# Historical execution artifacts — not current documentation

The files under `plans/` and `specs/` are **point-in-time working documents**: implementation plans and design specs written while a feature was being built. They are kept for provenance — why a design went the way it did — not as a description of how the system works now.

**They are stale by design and will not be updated.** Between them they reference roughly 30 files that no longer exist, including chart components deleted during PRD-06, `apps/web/src/lib/metaAnalysisColors.ts` (removed in #870), `apps/pipeline/requirements.txt` (the pipeline uses Poetry and `pyproject.toml`), and `tests/unit/test_worker_idle_hook.py`.

Do not treat anything here as a source of truth, and do not "fix" the stale references — that would defeat the point of keeping a historical record.

## Where to look instead

| For | See |
|---|---|
| Current requirements and design | [`prds/`](../../prds) |
| How the system is structured today | [`CLAUDE.md`](../../CLAUDE.md) |
| Development setup and workflows | [`docs/development.md`](../development.md) |
| Configuration reference | [`docs/configuration.md`](../configuration.md) |
| What changed and when | [`CHANGELOG.md`](../../CHANGELOG.md) |

Flagged by the 2026-08-08 codebase audit (#911): these live under `docs/` and are otherwise indistinguishable from living documentation to someone browsing the tree.
