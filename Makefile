.PHONY: up down build logs test test-unit test-e2e migrate shell-db shell-pipeline web

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

help:           ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'
