# Contributing

Thanks for helping! YorkFolio is deliberately small: **Python standard library only** on the
backend and **vanilla JS/CSS** on the frontend. Please keep it that way, with no runtime dependencies.

## Setup

```bash
git clone git@github.com:rarrifano/yorkfolio.git && cd yorkfolio
make run          # http://localhost:8000 (first visit asks you to create an account)
make check        # lint + tests: run this before every commit
```

Requirements: Python 3.10+, `make`. The linters run without installing anything: ruff comes from
its podman image (or a local `ruff`), Biome from `npx` (or a local `biome`).

## Code style

- `make format` fixes what it can; `make lint` must pass (CI runs the same thing).
- Python: [ruff](https://docs.astral.sh/ruff/) lint + formatter, 120 columns (`pyproject.toml`).
- JS/CSS: [Biome](https://biomejs.dev/) recommended rules + formatter (`biome.json`).
- Keep pure logic (engine, tax, history, valuation) free of I/O and add tests for it in `tests/`.
- UI text is Brazilian Portuguese; code, comments and commit messages are English.

## Pull requests

- One topic per PR, with a short description of the *why*.
- Tests for new calculations (synthetic data only).
- **Never commit personal data**: B3 exports, `data/`, databases or screenshots with real values.
