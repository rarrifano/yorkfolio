# YorkFolio — common tasks. Run `make` to list them.

PYTHON    ?= python3
HOST      ?= 0.0.0.0
PORT      ?= 8000
DATA      ?= $(CURDIR)/data
IMAGE     ?= localhost/yorkfolio:latest
CONTAINER ?= yorkfolio
FILES     ?= *.xlsx
LOGIN     ?=
YEAR      ?=
AMOUNT    ?=

# Inside a toolbox/distrobox, podman and systemd live on the host.
ON_HOST   := $(if $(wildcard /run/.containerenv),$(if $(shell command -v distrobox-host-exec 2>/dev/null),distrobox-host-exec))
PODMAN    ?= $(if $(shell command -v podman 2>/dev/null),podman,$(ON_HOST) podman)
SYSTEMCTL ?= $(ON_HOST) systemctl --user
QUADLET   ?= $(HOME)/.config/containers/systemd/$(CONTAINER).container

# Linters: local binaries when installed; otherwise run them without installing anything.
RUFF_VERSION  ?= 0.8.4
BIOME_VERSION ?= 1.9.4
RUFF  ?= $(or $(shell command -v ruff 2>/dev/null),$(PODMAN) run --rm --security-opt label=disable -v $(CURDIR):/io -w /io ghcr.io/astral-sh/ruff:$(RUFF_VERSION))
BIOME ?= $(or $(shell command -v biome 2>/dev/null),npx --yes @biomejs/biome@$(BIOME_VERSION))

# CT=1 runs CLI commands inside the running container instead of the local Python.
RUN_PY = $(if $(CT),$(PODMAN) exec -it $(CONTAINER) python3 run.py,$(PYTHON) run.py)
CLI    = $(RUN_PY) $(if $(LOGIN),--user $(LOGIN))

.DEFAULT_GOAL := help
.PHONY: help run test lint format check import market summary aporte ir backup user-add user-list user-passwd \
	user-del build up down restart logs shell status service service-remove clean

help: ## list the available targets
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
	  /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Development
run: ## start the web UI locally (HOST=0.0.0.0 PORT=8000)
	$(PYTHON) run.py serve --host $(HOST) --port $(PORT)

test: ## run the unit tests
	$(PYTHON) -m unittest discover -s tests

lint: ## check code style: ruff (Python) + Biome (JS/CSS)
	$(RUFF) check .
	$(RUFF) format --check .
	$(BIOME) check .

format: ## auto-fix what can be fixed, then format the code (`make lint` reports the rest)
	-$(RUFF) check --fix --quiet .
	$(RUFF) format .
	-$(BIOME) check --write .

check: lint test ## lint + tests (run before committing)

##@ Portfolio CLI (LOGIN=name when there are several accounts; CT=1 to run inside the container)
import: ## import B3 exports: make import FILES="movimentacao-*.xlsx negociacao-*.xlsx"
	$(CLI) import $(FILES)

market: ## refresh quotes, price history, Tesouro and BCB data
	$(CLI) market

summary: ## print the portfolio in the terminal
	$(CLI) summary

aporte: ## suggest how to invest: make aporte AMOUNT=5000
	$(CLI) aporte $(AMOUNT)

ir: ## IR report: make ir YEAR=2026
	$(CLI) ir $(YEAR)

backup: ## snapshot all databases into data/backups/<timestamp>/
	$(RUN_PY) backup

##@ Accounts
user-add: ## create an account: make user-add LOGIN=name [ADMIN=1]
	$(RUN_PY) user add $(LOGIN) $(if $(ADMIN),--admin)

user-list: ## list accounts
	$(RUN_PY) user list

user-passwd: ## change a password: make user-passwd LOGIN=name
	$(RUN_PY) user passwd $(LOGIN)

user-del: ## delete an account (its database is moved to data/users/deleted/)
	$(RUN_PY) user del $(LOGIN)

##@ Container (podman)
build: ## build the image
	$(PODMAN) build -t $(IMAGE) -f Containerfile .

up: build ## run the container in the background (data in ./data, port PORT)
	@mkdir -p $(DATA)
	-@$(PODMAN) rm -f $(CONTAINER) >/dev/null 2>&1
	$(PODMAN) run -d --name $(CONTAINER) -p $(PORT):8000 -v $(DATA):/data:z --userns=keep-id \
	  --restart=unless-stopped $(IMAGE)
	@echo "YorkFolio: http://localhost:$(PORT)"

down: ## stop and remove the container
	-$(PODMAN) rm -f $(CONTAINER)

restart: down up ## rebuild and restart the container

logs: ## follow the container logs
	$(PODMAN) logs -f $(CONTAINER)

shell: ## open a shell inside the running container
	$(PODMAN) exec -it $(CONTAINER) bash

status: ## show the container status
	$(PODMAN) ps -a --filter name=$(CONTAINER)

service: build ## run as a systemd user service (Quadlet), restarted on failure and at login
	@mkdir -p $(dir $(QUADLET)) $(DATA)
	-@$(PODMAN) rm -f $(CONTAINER) >/dev/null 2>&1
	@printf '%s\n' '[Unit]' 'Description=YorkFolio portfolio tracker' '' \
	  '[Container]' 'Image=$(IMAGE)' 'ContainerName=$(CONTAINER)' 'PublishPort=$(PORT):8000' \
	  'Volume=$(DATA):/data:z' 'UserNS=keep-id' '' '[Service]' 'Restart=on-failure' '' \
	  '[Install]' 'WantedBy=default.target' > $(QUADLET)
	$(SYSTEMCTL) daemon-reload
	$(SYSTEMCTL) restart $(CONTAINER).service
	@echo "YorkFolio service: http://localhost:$(PORT)  (logs: journalctl --user -u $(CONTAINER))"

service-remove: ## stop and remove the systemd service
	-$(SYSTEMCTL) stop $(CONTAINER).service
	rm -f $(QUADLET)
	$(SYSTEMCTL) daemon-reload

clean: ## remove caches (keeps ./data)
	find . -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .ruff_cache
