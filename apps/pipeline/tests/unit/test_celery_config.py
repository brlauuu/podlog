"""Tests for Celery task routing configuration."""

from app.tasks.celery_app import celery_app


HEAVY_TASKS = ["transcribe_episode", "diarize_episode"]
LIGHT_TASKS = [
    "infer_speakers",
    "download_episode",
    "archive_episode",
    "ingest_episode",
    "ingest_feed",
    "cleanup_zombie_jobs",
    "poll_all_feeds",
]


def test_heavy_tasks_route_to_heavy_queue():
    routes = celery_app.conf.task_routes
    for task_name in HEAVY_TASKS:
        assert routes[task_name]["queue"] == "heavy", f"{task_name} should route to heavy"


def test_light_tasks_route_to_light_queue():
    routes = celery_app.conf.task_routes
    for task_name in LIGHT_TASKS:
        assert routes[task_name]["queue"] == "light", f"{task_name} should route to light"


def test_default_queue_is_light():
    assert celery_app.conf.task_default_queue == "light"


def test_all_registered_tasks_have_routes():
    """Every task in the 'include' modules should have an explicit route."""
    routes = celery_app.conf.task_routes
    routed_tasks = set(routes.keys())
    expected = set(HEAVY_TASKS + LIGHT_TASKS)
    assert routed_tasks == expected


def test_no_tasks_route_to_default_celery_queue():
    """No task should route to the built-in 'celery' queue."""
    routes = celery_app.conf.task_routes
    for task_name, route in routes.items():
        assert route["queue"] != "celery", f"{task_name} routes to default 'celery' queue"
