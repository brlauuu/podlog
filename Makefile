.PHONY: up down build logs test test-unit test-e2e migrate shell-db shell-pipeline web ollama-pull

up:             ## Start full stack
	docker compose up -d

down:           ## Stop all services
	docker compose down

build:          ## Rebuild all images
	docker compose build

logs:           ## Follow logs for all services
	docker compose logs -f

migrate:        ## Run database migrations manually (also runs on pipeline startup)
	docker compose exec pipeline alembic upgrade head

test:           ## Run all tests (unit + e2e)
	docker compose -f docker-compose.test.yml run --rm test
	docker compose -f docker-compose.test.yml run --rm web_test

test-unit:      ## Run unit tests only (fast, no Docker required for ML models)
	docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v

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

ollama-pull:    ## Pull default Ollama model (Qwen2.5-3B Q4)
	docker compose exec ollama ollama pull qwen2.5:3b

health-check:   ## Run health check once (requires python3, pg_isready, docker)
	python3 scripts/healthcheck.py

health-install: ## Install health check cron job (every 15 min)
	bash scripts/healthcheck-install.sh

health-uninstall: ## Remove health check cron job
	crontab -l 2>/dev/null | grep -vF "healthcheck.py" | crontab - && echo "Removed healthcheck cron job"

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
