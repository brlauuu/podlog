"""
Podlog notebook plot helpers — speaker analysis (PRD-06).

Reusable module wrapping the speaker plot helpers from the 2026-05-15
prototype. Drops standalone-HTML save plumbing; functions return go.Figure
objects so the notebook can display or restyle them.

Connection reads POSTGRES_HOST (default "db") and POSTGRES_PASSWORD from the
environment. When running inside the explore Docker service the default host
"db" points at the podlog DB container. Override POSTGRES_HOST for local dev.

Click-to-open URLs route via PODLOG_WEB_URL (default "http://localhost:3000").
"""
from __future__ import annotations

import os

import pandas as pd
import plotly.graph_objects as go
from plotly.colors import qualitative
from sqlalchemy import create_engine, text

# ---------------------------------------------------------------------------
# Connection — reads from env vars so the module works both inside the
# explore Docker service (POSTGRES_HOST=db) and in local dev.
# ---------------------------------------------------------------------------
PG_HOST = os.environ.get("POSTGRES_HOST", "db")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD")
if not PG_PASSWORD:
    raise SystemExit("POSTGRES_PASSWORD must be set in the env")

ENGINE = create_engine(
    f"postgresql+psycopg2://postgres:{PG_PASSWORD}@{PG_HOST}:5432/podlog"
)

# ---------------------------------------------------------------------------
# Web-app base URL — used to build click-to-open episode links.
# Override via PODLOG_WEB_URL when the notebook runs outside Docker.
# ---------------------------------------------------------------------------
PODLOG_WEB_URL = os.environ.get("PODLOG_WEB_URL", "http://localhost:3000")

# ---------------------------------------------------------------------------
# Shared conventions (PRD-06 §3).
# ---------------------------------------------------------------------------
FEED_SHORT = {
    "Lenny's Podcast: Product | Career | Growth": "Lenny's Podcast",
    "The Jacob Shapiro Podcast": "Jacob Shapiro",
    "Dwarkesh Podcast": "Dwarkesh",
    "Geopolitical Cousins": "Geopolitical Cousins",
    "Agelast podcast": "Agelast",
    "The Twenty Minute VC (20VC): Venture Capital | Startup Funding | The Pitch": "20VC",
}
PALETTE = qualitative.Plotly
HOST_PALETTE = qualitative.D3
GUEST_PALETTE = qualitative.Pastel
HOST_THRESHOLD = 0.25

LEGEND_BELOW = dict(orientation="h", yanchor="top", y=-0.2, xanchor="center", x=0.5)


def _hex_to_rgba(hex_color: str, alpha: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


def _short(title: str) -> str:
    return FEED_SHORT.get(title, title)


# ---------------------------------------------------------------------------
# Speaker plot constants (PRD-06 §6).
# ---------------------------------------------------------------------------
SPEAKER_SOURCES = {
    "confirmed": {
        "label": "Confirmed",
        "where": "sn.confirmed_by_user = TRUE AND sn.role IN ('host', 'guest')",
    },
    "inferred_high": {
        "label": "Inferred (HIGH confidence)",
        "where": "sn.inferred = TRUE AND sn.confidence = 'HIGH'",
    },
}

SPEAKER_METRICS = {
    "minutes": {
        "sql_expr": "SUM(s.end_time - s.start_time) / 60.0",
        "axis_suffix": " min",
        "value_label": "min",
        "hover_value": "%{y:.1f} min",
        "guest_hover_value": "%{y:.1f} min total",
        "title_unit": "minutes",
    },
    "words": {
        "sql_expr": (
            "COALESCE(SUM("
            "  CASE WHEN length(trim(s.text)) > 0"
            "       THEN array_length(regexp_split_to_array(trim(s.text), '\\s+'), 1)"
            "       ELSE 0 END"
            "), 0)"
        ),
        "axis_suffix": "",
        "value_label": "words",
        "hover_value": "%{y:,.0f} words",
        "guest_hover_value": "%{y:,.0f} words total",
        "title_unit": "word count",
    },
}

SPEAKER_SLUGS = {
    ("minutes", "confirmed"): "03_speakers_min_confirmed",
    ("minutes", "inferred_high"): "04_speakers_min_inferred",
    ("words", "confirmed"): "05_speakers_words_confirmed",
    ("words", "inferred_high"): "06_speakers_words_inferred",
}

SPEAKER_DIFF_SLUGS = {
    "confirmed": "07_speakers_diff_confirmed",
    "inferred_high": "08_speakers_diff_inferred",
}


# ---------------------------------------------------------------------------
# Internal helpers.
# ---------------------------------------------------------------------------

def _confirmed_role_map() -> dict[tuple[str, str], bool]:
    """(short-feed, display_name) -> True if confirmed as host in that feed.

    Used to inherit roles into the inferred plot. Majority wins; ties -> host.
    """
    q = text("""
        SELECT f.title AS feed, sn.display_name, sn.role, COUNT(*) AS n
        FROM speaker_names sn
        JOIN episodes e ON e.id = sn.episode_id
        JOIN feeds f ON f.id = e.feed_id
        WHERE sn.confirmed_by_user = TRUE AND sn.role IN ('host', 'guest')
        GROUP BY f.title, sn.display_name, sn.role
    """)
    with ENGINE.connect() as conn:
        df = pd.read_sql(q, conn)
    if df.empty:
        return {}
    df["feed"] = df["feed"].map(_short)
    wide = df.pivot_table(
        index=["feed", "display_name"], columns="role", values="n", fill_value=0
    )
    if "host" not in wide:
        wide["host"] = 0
    if "guest" not in wide:
        wide["guest"] = 0
    return (wide["host"] >= wide["guest"]).to_dict()


def _load_speaker_data(
    source: str, metric: str
) -> tuple[pd.DataFrame, dict[tuple[str, str], bool]]:
    """Run the per-speaker query for (source, metric) and build (feed, name) -> is_host.

    The returned DataFrame includes an ``episode_link`` column built from
    PODLOG_WEB_URL + the episode UUID. Pass ``episode_link`` (not the legacy
    ``episode_url``) into customdata for click-to-open behaviour.
    """
    cfg = SPEAKER_SOURCES[source]
    mcfg = SPEAKER_METRICS[metric]
    q = text(f"""
        SELECT
            f.title AS feed,
            e.id   AS episode_id,
            e.title AS episode_title,
            e.episode_url,
            e.published_at,
            sn.display_name,
            sn.role,
            {mcfg['sql_expr']} AS value
        FROM segments s
        JOIN episodes e ON e.id = s.episode_id
        JOIN feeds    f ON f.id = e.feed_id
        JOIN speaker_names sn
            ON sn.episode_id    = s.episode_id
           AND sn.speaker_label = s.speaker_label
        WHERE e.published_at IS NOT NULL
          AND ({cfg['where']})
        GROUP BY f.title, e.id, e.title, e.episode_url, e.published_at, sn.display_name, sn.role
    """)
    with ENGINE.connect() as conn:
        df = pd.read_sql(q, conn)
    if df.empty:
        return df, {}

    df["feed"] = df["feed"].map(_short)
    df["published_at"] = pd.to_datetime(df["published_at"]).dt.tz_localize(None)
    # Build web-app episode links (preferred over the raw episode_url for click-to-open).
    df["episode_link"] = PODLOG_WEB_URL + "/episodes/" + df["episode_id"].astype(str)

    # Host classification.
    #   - Confirmed source: use the explicit role column (majority per name+feed).
    #   - Inferred source:  role is always NULL, so inherit from the confirmed
    #                       table first; fall back to the 25%-of-episodes heuristic.
    if source == "confirmed":
        rc = df.groupby(["feed", "display_name", "role"]).size().unstack(fill_value=0)
        if "host" not in rc:
            rc["host"] = 0
        if "guest" not in rc:
            rc["guest"] = 0
        role = (rc["host"] >= rc["guest"]).to_dict()
    else:
        confirmed_roles = _confirmed_role_map()
        feed_ep_counts = df.groupby("feed")["episode_id"].nunique()
        speaker_ep_counts = (
            df.groupby(["feed", "display_name"])["episode_id"]
            .nunique()
            .reset_index(name="ep_count")
        )
        speaker_ep_counts["feed_eps"] = speaker_ep_counts["feed"].map(feed_ep_counts)
        speaker_ep_counts["heuristic_host"] = (
            speaker_ep_counts["ep_count"] / speaker_ep_counts["feed_eps"] >= HOST_THRESHOLD
        )
        role = {}
        for _, r in speaker_ep_counts.iterrows():
            key = (r["feed"], r["display_name"])
            if key in confirmed_roles:
                role[key] = confirmed_roles[key]
            else:
                role[key] = bool(r["heuristic_host"])
    return df, role


# ---------------------------------------------------------------------------
# Public plot functions.
# ---------------------------------------------------------------------------

def plot_speakers(source: str = "confirmed", metric: str = "minutes") -> go.Figure | None:
    """Per-speaker minutes (or words) per episode, with a per-feed dropdown.

    Parameters
    ----------
    source:
        ``"confirmed"`` or ``"inferred_high"`` (keys of SPEAKER_SOURCES).
    metric:
        ``"minutes"`` or ``"words"`` (keys of SPEAKER_METRICS).

    Returns
    -------
    go.Figure, or None if there are no rows for the requested combination.
    """
    cfg = SPEAKER_SOURCES[source]
    mcfg = SPEAKER_METRICS[metric]
    df, role = _load_speaker_data(source, metric)
    if df.empty:
        print(f"plot_speakers({source}, {metric}): no rows — skipping")
        return None

    feeds = sorted(df["feed"].unique())
    fig = go.Figure()
    trace_feed: list[str] = []

    for feed in feeds:
        sub = df[df["feed"] == feed]
        totals = sub.groupby("display_name")["value"].sum().sort_values(ascending=False)
        hosts = [n for n in totals.index if role.get((feed, n), False)]

        # One trace per host.
        for host_i, name in enumerate(hosts):
            speaker = sub[sub["display_name"] == name].sort_values("published_at")
            color = HOST_PALETTE[host_i % len(HOST_PALETTE)]
            fig.add_trace(
                go.Scatter(
                    x=speaker["published_at"],
                    y=speaker["value"],
                    mode="markers+lines",
                    name=f"{name} (host)",
                    line=dict(width=2, color=color),
                    marker=dict(size=7, symbol="circle", color=color),
                    customdata=speaker[["episode_title", "episode_link"]].fillna("").to_numpy(),
                    hovertemplate=(
                        "%{x|%Y-%m-%d}<br>"
                        f"{mcfg['hover_value']}<br>"
                        "%{customdata[0]}<br>"
                        "<i>(click to open episode)</i>"
                        f"<extra><b>{name}</b> (host)</extra>"
                    ),
                    visible=(feed == feeds[0]),
                )
            )
            trace_feed.append(feed)

        # One combined "Guests" trace: sum value across all guests per episode.
        guest_rows = sub[~sub["display_name"].isin(hosts)]
        if not guest_rows.empty:
            combined = (
                guest_rows.groupby(
                    ["episode_id", "episode_title", "episode_link", "published_at"],
                    dropna=False,
                )
                .agg(
                    value=("value", "sum"),
                    guest_count=("display_name", "nunique"),
                    guest_names=(
                        "display_name",
                        lambda s: ", ".join(sorted(s.unique())),
                    ),
                )
                .reset_index()
                .sort_values("published_at")
            )
            combined["episode_link"] = combined["episode_link"].fillna("")
            color = GUEST_PALETTE[0]
            fig.add_trace(
                go.Scatter(
                    x=combined["published_at"],
                    y=combined["value"],
                    mode="markers+lines",
                    name="Guests (combined)",
                    line=dict(width=1, color=color, dash="dash"),
                    marker=dict(size=6, symbol="diamond", color=color),
                    customdata=combined[
                        ["episode_title", "guest_count", "guest_names", "episode_link"]
                    ].to_numpy(),
                    hovertemplate=(
                        "%{x|%Y-%m-%d}<br>"
                        f"{mcfg['guest_hover_value']}<br>"
                        "%{customdata[1]} guest(s): %{customdata[2]}<br>"
                        "%{customdata[0]}<br>"
                        "<i>(click to open episode)</i>"
                        "<extra><b>Guests</b> (combined)</extra>"
                    ),
                    visible=(feed == feeds[0]),
                )
            )
            trace_feed.append(feed)

    # Per-feed dropdown buttons (title set in the loop below once we know the metric).
    buttons = []
    for feed in feeds:
        visible = [tf == feed for tf in trace_feed]
        buttons.append(dict(method="update", label=feed, args=[{"visible": visible}, {}]))

    initial_feed = feeds[0]
    initial_hosts = [
        n for n in df[df["feed"] == initial_feed]
        .groupby("display_name")["value"].sum().sort_values(ascending=False).index
        if role.get((initial_feed, n), False)
    ]
    initial_hosts_label = ", ".join(initial_hosts) if initial_hosts else "(none detected)"

    fig.update_layout(
        title=(
            f"Per-speaker {mcfg['title_unit']} per episode — {initial_feed} "
            f"<i>({cfg['label']})</i>"
            f"<br><sub>Detected hosts: {initial_hosts_label}</sub>"
        ),
        hovermode="x unified",
        legend=LEGEND_BELOW,
        margin=dict(b=160, t=110),
        xaxis=dict(
            showspikes=True,
            spikemode="across",
            spikesnap="cursor",
            spikedash="dot",
            spikethickness=1,
        ),
        updatemenus=[
            dict(
                type="dropdown",
                buttons=buttons,
                direction="down",
                x=0.0,
                y=1.18,
                xanchor="left",
                yanchor="top",
            )
        ],
    )
    fig.update_yaxes(ticksuffix=mcfg["axis_suffix"])

    # Per-feed dropdown title — set after we know source + metric.
    for b in buttons:
        feed = b["label"]
        sub = df[df["feed"] == feed]
        totals = sub.groupby("display_name")["value"].sum().sort_values(ascending=False)
        hosts = [n for n in totals.index if role.get((feed, n), False)]
        hosts_label = ", ".join(hosts) if hosts else "(none detected)"
        b["args"][1]["title"] = (
            f"Per-speaker {mcfg['title_unit']} per episode — {feed} "
            f"<i>({cfg['label']})</i>"
            f"<br><sub>Detected hosts: {hosts_label}</sub>"
        )

    return fig


def plot_speaker_diff(source: str = "confirmed") -> go.Figure | None:
    """Per-episode signed diff: guest_avg_minutes - host_avg_minutes.

    Shaded band shows the widest possible diff given individual speaker variation:
    [min_guest - max_host, max_guest - min_host].

    Parameters
    ----------
    source:
        ``"confirmed"`` or ``"inferred_high"`` (keys of SPEAKER_SOURCES).

    Returns
    -------
    go.Figure, or None if there are no rows for the requested combination.
    """
    cfg = SPEAKER_SOURCES[source]
    df, role = _load_speaker_data(source, "minutes")
    if df.empty:
        print(f"plot_speaker_diff({source}): no rows — skipping")
        return None

    df["is_host"] = [role.get((f, n), False) for f, n in zip(df["feed"], df["display_name"])]

    # Per (feed, episode): aggregate host side and guest side separately.
    grp_cols = ["feed", "episode_id", "episode_title", "episode_link", "published_at"]
    agg = (
        df.groupby(grp_cols + ["is_host"], dropna=False)["value"]
        .agg(["mean", "min", "max", "count"])
        .unstack("is_host")
    )
    # Columns are now MultiIndex like (mean, True), (mean, False), etc.
    def col(stat: str, host: bool) -> pd.Series:
        try:
            return agg[(stat, host)]
        except KeyError:
            return pd.Series(index=agg.index, dtype=float)

    out = pd.DataFrame(
        {
            "host_mean":  col("mean",  True),
            "host_min":   col("min",   True),
            "host_max":   col("max",   True),
            "host_count": col("count", True),
            "guest_mean":  col("mean",  False),
            "guest_min":   col("min",   False),
            "guest_max":   col("max",   False),
            "guest_count": col("count", False),
        }
    ).reset_index()

    # Collect speaker names per (episode, side) for the hover tooltip.
    names = (
        df.groupby(grp_cols + ["is_host"])["display_name"]
        .apply(lambda s: ", ".join(sorted(s.unique())))
        .unstack("is_host")
    )
    if True not in names.columns:
        names[True] = ""
    if False not in names.columns:
        names[False] = ""
    names = names.rename(columns={True: "host_names", False: "guest_names"}).reset_index()
    out = out.merge(names[grp_cols + ["host_names", "guest_names"]], on=grp_cols, how="left")
    out["host_names"] = out["host_names"].fillna("")
    out["guest_names"] = out["guest_names"].fillna("")

    # Only episodes with BOTH a host and a guest can be compared.
    out = out.dropna(subset=["host_mean", "guest_mean"])
    if out.empty:
        print(f"plot_speaker_diff({source}): no episodes with both host and guest — skipping")
        return None

    out["diff"] = out["guest_mean"] - out["host_mean"]
    out["band_lo"] = out["guest_min"] - out["host_max"]
    out["band_hi"] = out["guest_max"] - out["host_min"]
    out["episode_link"] = out["episode_link"].fillna("")
    out = out.sort_values(["feed", "published_at"])

    feeds = sorted(out["feed"].unique())
    fig = go.Figure()
    trace_feed: list[str] = []

    for i, feed in enumerate(feeds):
        sub = out[out["feed"] == feed]
        color = PALETTE[i % len(PALETTE)]
        fill = _hex_to_rgba(color, 0.18)

        # Upper-band line (invisible).
        fig.add_trace(
            go.Scatter(
                x=sub["published_at"], y=sub["band_hi"], mode="lines",
                line=dict(width=0), hoverinfo="skip", showlegend=False,
                visible=(feed == feeds[0]),
            )
        )
        trace_feed.append(feed)
        # Lower-band line with fill.
        fig.add_trace(
            go.Scatter(
                x=sub["published_at"], y=sub["band_lo"], mode="lines",
                line=dict(width=0), fill="tonexty", fillcolor=fill,
                hoverinfo="skip", showlegend=False,
                visible=(feed == feeds[0]),
            )
        )
        trace_feed.append(feed)
        # Center line: signed diff per episode.
        customdata = sub[
            ["episode_title", "host_mean", "host_count", "guest_mean", "guest_count",
             "host_names", "guest_names", "episode_link"]
        ].to_numpy()
        fig.add_trace(
            go.Scatter(
                x=sub["published_at"], y=sub["diff"], mode="markers+lines",
                line=dict(width=2, color=color),
                marker=dict(size=7, color=color),
                name=f"{feed} (guest - host avg, min)",
                customdata=customdata,
                hovertemplate=(
                    "%{x|%Y-%m-%d}<br>"
                    "Δ = %{y:+.1f} min  (guest - host avg)<br>"
                    "Hosts (%{customdata[2]}, avg %{customdata[1]:.1f} min): %{customdata[5]}<br>"
                    "Guests (%{customdata[4]}, avg %{customdata[3]:.1f} min): %{customdata[6]}<br>"
                    "%{customdata[0]}<br>"
                    "<i>(click to open episode)</i>"
                    f"<extra>{feed}</extra>"
                ),
                visible=(feed == feeds[0]),
            )
        )
        trace_feed.append(feed)

    # y=0 reference line.
    fig.add_hline(y=0, line=dict(color="#888", width=1, dash="dot"))

    # Per-feed dropdown.
    buttons = []
    initial_feed = feeds[0]
    for feed in feeds:
        visible = [tf == feed for tf in trace_feed]
        sub = out[out["feed"] == feed]
        n_eps = len(sub)
        guests_more = int((sub["diff"] > 0).sum())
        hosts_more = int((sub["diff"] < 0).sum())
        subtitle = (
            f"{n_eps} episode(s) compared — "
            f"guests talked more in {guests_more}, hosts in {hosts_more}"
        )
        buttons.append(
            dict(
                method="update",
                label=feed,
                args=[
                    {"visible": visible},
                    {
                        "title": (
                            f"Host vs Guest talking time per episode — {feed} "
                            f"<i>({cfg['label']})</i><br><sub>{subtitle}</sub>"
                        )
                    },
                ],
            )
        )

    init_sub = out[out["feed"] == initial_feed]
    init_subtitle = (
        f"{len(init_sub)} episode(s) compared — "
        f"guests talked more in {int((init_sub['diff'] > 0).sum())}, "
        f"hosts in {int((init_sub['diff'] < 0).sum())}"
    )

    fig.update_layout(
        title=(
            f"Host vs Guest talking time per episode — {initial_feed} "
            f"<i>({cfg['label']})</i><br><sub>{init_subtitle}</sub>"
        ),
        hovermode="x unified",
        legend=LEGEND_BELOW,
        margin=dict(b=160, t=110),
        xaxis=dict(
            showspikes=True,
            spikemode="across",
            spikesnap="cursor",
            spikedash="dot",
            spikethickness=1,
        ),
        updatemenus=[
            dict(
                type="dropdown",
                buttons=buttons,
                direction="down",
                x=0.0, y=1.18,
                xanchor="left", yanchor="top",
            )
        ],
        yaxis_title="Δ minutes (guest avg - host avg)",
    )
    fig.update_yaxes(ticksuffix=" min", zeroline=False)
    return fig


__all__ = [
    "plot_speakers",
    "plot_speaker_diff",
    "SPEAKER_SOURCES",
    "SPEAKER_METRICS",
    "PODLOG_WEB_URL",
]
