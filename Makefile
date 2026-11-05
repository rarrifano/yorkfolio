# YorkFolio — common tasks. Run `make` to list them.

PYTHON    ?= python3
HOST      ?= 0.0.0.0
PORT      ?= 8000
DATA      ?= $(CURDIR)/data
VOLUME    ?= yorkfolio-data
# IMAGE: localhost/... builds from source; a registry image (ghcr.io/rarrifano/yorkfolio:0.1) is pulled.
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
QUADLET   ?= $(HOME)/.config/containers/systemd

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
	user-del build image volume up down restart logs shell status volume-import volume-export service service-remove clean

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

##@ Container (podman: data lives in the named volume VOLUME=yorkfolio-data)
build: ## build the image from source
	$(PODMAN) build -t $(IMAGE) -f Containerfile .

image: ## build IMAGE if it is a localhost/ tag, otherwise pull it from the registry
	$(if $(filter localhost/%,$(IMAGE)),$(PODMAN) build -t $(IMAGE) -f Containerfile .,$(PODMAN) pull $(IMAGE))

volume: ## create the data volume (no-op if it exists)
	@$(PODMAN) volume exists $(VOLUME) || $(PODMAN) volume create $(VOLUME)

up: image volume ## run the container in the background on port PORT
	-@$(PODMAN) rm -f $(CONTAINER) >/dev/null 2>&1
	$(PODMAN) run -d --name $(CONTAINER) -p $(PORT):8000 -v $(VOLUME):/data --restart=unless-stopped $(IMAGE)
	@echo "YorkFolio: http://localhost:$(PORT)"

down: ## stop and remove the container (the volume is kept)
	-$(PODMAN) rm -f $(CONTAINER)

restart: down up ## rebuild and restart the container

logs: ## follow the container logs
	$(PODMAN) logs -f $(CONTAINER)

shell: ## open a shell inside the running container
	$(PODMAN) exec -it $(CONTAINER) bash

status: ## show the container and volume
	$(PODMAN) ps -a --filter name=$(CONTAINER)
	$(PODMAN) volume inspect $(VOLUME) --format '{{.Name}}: {{.Mountpoint}}'

volume-import: image volume ## copy a local data dir (DATA=./data) into the volume; FORCE=1 to overwrite
	@$(PODMAN) stop $(CONTAINER) >/dev/null 2>&1 || true
	$(PODMAN) run --rm --user 0 -e FORCE=$(FORCE) -v $(DATA):/src:ro,z -v $(VOLUME):/data --entrypoint sh $(IMAGE) -c \
	  'if [ -e /data/auth.db ] && [ -z "$$FORCE" ]; then echo "volume already has data (FORCE=1 to overwrite)"; exit 1; fi; \
	   cp -a /src/. /data/ && chown -R 1000:1000 /data && echo "imported into $(VOLUME)"'
	@echo "now run: make up"

volume-export: ## save the volume to a tarball in the current directory
	$(PODMAN) volume export $(VOLUME) --output $(CURDIR)/$(VOLUME)-$$(date +%Y%m%d-%H%M%S).tar

service: image ## run as a systemd user service (Quadlet), restarted on failure and at login
	@mkdir -p $(QUADLET)
	-@$(PODMAN) rm -f $(CONTAINER) >/dev/null 2>&1
	@printf '%s\n' '[Volume]' 'VolumeName=$(VOLUME)' > $(QUADLET)/$(VOLUME).volume
	@printf '%s\n' '[Unit]' 'Description=YorkFolio portfolio tracker' '' \
	  '[Container]' 'Image=$(IMAGE)' 'ContainerName=$(CONTAINER)' 'PublishPort=$(PORT):8000' \
	  'Volume=$(VOLUME).volume:/data' '' '[Service]' 'Restart=on-failure' '' \
	  '[Install]' 'WantedBy=default.target' > $(QUADLET)/$(CONTAINER).container
	$(SYSTEMCTL) daemon-reload
	$(SYSTEMCTL) restart $(CONTAINER).service
	@echo "YorkFolio service: http://localhost:$(PORT)  (logs: journalctl --user -u $(CONTAINER))"

service-remove: ## stop and remove the systemd service (the volume is kept)
	-$(SYSTEMCTL) stop $(CONTAINER).service
	rm -f $(QUADLET)/$(CONTAINER).container $(QUADLET)/$(VOLUME).volume
	$(SYSTEMCTL) daemon-reload

clean: ## remove caches (keeps ./data and the volume)
	find . -name __pycache__ -prune -exec rm -rf {} +
	rm -rf .ruff_cache
