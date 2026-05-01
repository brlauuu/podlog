.PHONY: up up-remote down down-remote build logs logs-remote test test-unit test-healthcheck test-e2e migrate shell-db shell-pipeline web ollama-pull version backfill env-check deps-outdated explore explore-down explore-logs backup-now backup-list restore-db restore-audio

up:             ## Start full stack
	docker compose up -d

up-remote:      ## Start remote-inference profile (Fireworks providers, no Ollama)
	docker compose -f docker-compose.yml -f docker-compose.remote.yml up -d

down:           ## Stop all services
	docker compose down

down-remote:    ## Stop remote-inference profile stack
	docker compose -f docker-compose.yml -f docker-compose.remote.yml down

build:          ## Rebuild all images (reads version from VERSION file)
	@cp VERSION apps/pipeline/VERSION
	@cp VERSION apps/web/VERSION
	docker compose build --build-arg APP_VERSION=$$(cat VERSION)
	@rm -f apps/pipeline/VERSION apps/web/VERSION

logs:           ## Follow logs for all services
	docker compose logs -f

logs-remote:    ## Follow logs for remote-inference profile stack
	docker compose -f docker-compose.yml -f docker-compose.remote.yml logs -f

migrate:        ## Run database migrations manually (also runs on pipeline startup)
	docker compose exec pipeline alembic upgrade head

test:           ## Run all tests (unit + e2e)
	docker compose -f docker-compose.test.yml run --rm test
	docker compose -f docker-compose.test.yml run --rm web_test
	python3 -m pytest apps/pipeline/tests/unit/test_healthcheck_script.py -v

test-unit:      ## Run unit tests only (fast, no Docker required for ML models)
	docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v
	python3 -m pytest apps/pipeline/tests/unit/test_healthcheck_script.py -v

test-healthcheck: ## Run host healthcheck script tests
	python3 -m pytest apps/pipeline/tests/unit/test_healthcheck_script.py -v

test-integration: ## Run integration tests (requires HF_TOKEN for pyannote)
	docker compose -f docker-compose.test.yml run --rm test pytest tests/integration/ -v

test-e2e:       ## Run Playwright end-to-end tests
	docker compose -f docker-compose.test.yml run --rm web_test

shell-db:       ## Open psql shell
	docker compose exec db psql -U postgres podlog

shell-pipeline: ## Open shell in pipeline container
	docker compose exec pipeline bash

shell-web:      ## Open shell in web container
	docker compose exec web sh

web:            ## Open web app in browser
	open http://localhost:3000

ollama-pull:    ## Pull Ollama models used by the Ask feature
	docker compose exec ollama ollama pull qwen2.5:3b
	docker compose exec ollama ollama pull phi3:mini
	docker compose exec ollama ollama pull gemma4:e4b

explore:        ## Start the Jupyter DB-exploration service (#607). URL+token printed in logs.
	docker compose --profile explore up -d explore
	@echo ""
	@echo "Jupyter is starting on http://localhost:8888"
	@echo "Get the access token from the logs:"
	@echo "  make explore-logs"
	@echo "Look for the line that ends with /lab?token=<...>"

explore-down:   ## Stop the explore service
	docker compose --profile explore down explore

explore-logs:   ## Follow the explore service logs (look for the token URL)
	docker compose --profile explore logs -f explore

backup-now:     ## Force a backup run right now (bypasses the daily flag).
	@docker compose exec backup sh -c 'rm -f /backups/.last_run && /usr/local/bin/backup.sh & sleep 2; pkill -f "sleep " || true' 2>/dev/null || true
	@docker compose exec backup ls -la /backups/db/daily | tail -5
	@echo "Tip: tail logs with: docker compose logs -f backup"

backup-list:    ## List available DB dumps and audio snapshots.
	@echo "DB dumps (daily):"
	@docker compose exec backup sh -c 'ls /backups/db/daily 2>/dev/null | sort | head -10' || true
	@echo "DB dumps (weekly):"
	@docker compose exec backup sh -c 'ls /backups/db/weekly 2>/dev/null | sort' || true
	@echo "DB dumps (monthly):"
	@docker compose exec backup sh -c 'ls /backups/db/monthly 2>/dev/null | sort' || true
	@echo "Audio snapshots:"
	@docker compose exec backup sh -c 'ls /backups/audio 2>/dev/null | sort | head -10' || true

restore-db:     ## DESTRUCTIVE: restore the DB from a dated dump. Usage: make restore-db DATE=YYYY-MM-DD
	@if [ -z "$(DATE)" ]; then echo "Usage: make restore-db DATE=YYYY-MM-DD"; exit 1; fi
	@echo "About to DROP and recreate the 'podlog' database from backup dated $(DATE)."
	@printf "Type 'yes' to continue: "; read confirm; [ "$$confirm" = "yes" ] || { echo "aborted"; exit 1; }
	docker compose stop pipeline worker web
	docker compose exec backup /usr/local/bin/restore-db.sh $(DATE)
	docker compose start pipeline worker web

restore-audio:  ## DESTRUCTIVE: restore audio archive from a dated snapshot. Usage: make restore-audio DATE=YYYY-MM-DD
	@if [ -z "$(DATE)" ]; then echo "Usage: make restore-audio DATE=YYYY-MM-DD"; exit 1; fi
	@echo "About to overwrite /data/audio/archive from snapshot dated $(DATE)."
	@printf "Type 'yes' to continue: "; read confirm; [ "$$confirm" = "yes" ] || { echo "aborted"; exit 1; }
	docker compose exec backup /usr/local/bin/restore-audio.sh $(DATE)

health-check:   ## Run health check once (requires python3, pg_isready, docker)
	python3 scripts/healthcheck.py

health-install: ## Install health check cron job (every 15 min)
	bash scripts/healthcheck-install.sh

health-uninstall: ## Remove health check cron job
	crontab -l 2>/dev/null | grep -vF "healthcheck.py" | crontab - && echo "Removed healthcheck cron job"

backfill:       ## Run chunk+embed backfill (stops worker, runs backfill, restarts worker)
	@echo "Stopping worker..."
	docker compose stop worker
	@echo "Triggering backfill (chunks + embeddings)..."
	@curl -s -X POST http://localhost:8000/api/backfill/chunks?embed=true | python3 -m json.tool
	@echo "\nBackfill started. Poll progress with:"
	@echo "  curl -s http://localhost:8000/api/backfill/status | python3 -m json.tool"
	@echo "\nWhen done, restart the worker with:"
	@echo "  docker compose start worker"

version:        ## Show current version
	@cat VERSION

env-check:      ## Validate local Node runtime against apps/web requirement
	@bash scripts/check-web-node-version.sh

deps-outdated:  ## Check npm outdated packages with resilient network handling
	@bash scripts/check-web-node-version.sh
	@bash scripts/check-npm-outdated.sh

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
