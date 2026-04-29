# Database Exploration with Jupyter

> **Heads up.** This is an opt-in advanced feature. The default `docker compose up` does not start it, and the web UI does not surface it prominently. If you don't write Python and don't need ad-hoc DB queries, you don't need this.

The `explore` service spins up a [JupyterLab](https://jupyterlab.readthedocs.io/) container preconfigured with a connection to the Podlog database. It's intended for users who want pandas/Plotly-driven analysis on top of the same data the app reads, without writing one-off scripts or hand-crafting SQL through `make shell-db` (Issue #607).

## What's preinstalled

- `jupyterlab`, `ipywidgets`
- `pandas`, `numpy`
- `plotly` (for inline charts)
- `sqlalchemy`, `psycopg2-binary`

Versions are pinned in `apps/explore/requirements.txt`.

## Starting it

```sh
make explore
```

Equivalent to `docker compose --profile explore up -d explore`. The Compose **profile** (`explore`) keeps the service out of the default startup so a regular `make up` doesn't pull or run it.

After the container starts, get the access token from the logs:

```sh
make explore-logs
```

Look for a line ending with `?token=<long hex string>` and open it in your browser. The URL will be of the form:

```
http://127.0.0.1:8888/lab?token=<your-token>
```

The token is regenerated on every container start. The port is bound to `127.0.0.1:8888` only (not exposed off-machine) — the token is the only auth between the Jupyter UI and your DB, so don't reverse-proxy this without adding stronger auth.

To stop:

```sh
make explore-down
```

## What's in the container

- **`/workspace`** — mounted from the repo's `notebooks/` directory. Anything you save here persists on the host.
  - `examples/01_explore_db.ipynb` — checked-in starter notebook (do not edit; copy if you want to modify).
  - Anything else you create — local-only, gitignored.
- **`DATABASE_URL`** env var — already set to the Podlog Postgres instance. The example notebook reads it via `os.environ["DATABASE_URL"]`.

## Example notebook walkthrough

`examples/01_explore_db.ipynb` is the recommended starting point. It demonstrates:

1. **Connecting to the DB** — `create_engine(os.environ["DATABASE_URL"])`.
2. **Schema cheat sheet** — uses `sqlalchemy.inspect()` to dump every table's column names + types into a DataFrame. Re-run after a migration.
3. **Sample queries** — episodes per feed, episodes per status, recent episodes — all via `pd.read_sql(...)`.
4. **A Plotly bar chart** — episodes per feed, rendered inline.

After running through it once, copy/adapt the cells into your own notebook (anywhere under `notebooks/`).

## Web UI integration

A small status panel on the **Meta-Analysis** page indicates whether the explore container is running and links to the Jupyter URL. When the container is **not** running, it links here. The web UI does not start or stop the container — that's intentional, this is an advanced feature and the CLI is the right surface for it.

## Operational notes

- **Restart**: `make explore-down && make explore`. There's no in-app restart button (by design).
- **Port conflict**: if `127.0.0.1:8888` is already in use, you'll see a Compose port-binding error. Stop the other process or change the published port in `docker-compose.yml`.
- **Permissions**: the container runs as root and writes to `notebooks/` with root ownership. If you ever delete a checkpoint file from the host and hit a permission error, `sudo rm -rf notebooks/.ipynb_checkpoints` clears it.
- **Disk**: the JupyterLab image is ~1.5 GB. Build only happens when you run `make explore` for the first time (or after a deps bump).
- **Read-only DB usage is encouraged**: nothing in the example notebook writes to the DB, but you have full credentials. Be careful with `INSERT`/`UPDATE`/`DELETE` — there's no undo.

## Troubleshooting

- **"Could not connect" from a notebook cell** — check `docker compose ps db` is healthy. The `explore` service uses `depends_on: db` with healthcheck condition, so a fresh `make explore` should always have a usable DB, but a separately stopped DB after the fact will leave you stranded.
- **"Token not found" / login screen keeps reappearing** — the token rotates per restart. Run `make explore-logs` and copy the latest URL.
- **Notebook doesn't show up in the file browser** — confirm it's under `notebooks/` on the host. The container only sees `/workspace`, which is `notebooks/` mounted in.

---

**Next:** [Troubleshooting](17-troubleshooting.md) | **Back:** [Meta-Analysis Dashboard](15-meta-analysis.md) | **Home:** [Guide](README.md)
