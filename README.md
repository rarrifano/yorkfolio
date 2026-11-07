<p align="center"><img src="yorkfolio/static/logo.svg" width="96" alt="YorkFolio"></p>

<h1 align="center">YorkFolio</h1>

<p align="center">
  A self-hosted, holder-style portfolio tracker for B3 investors.<br>
  <a href="https://github.com/rarrifano/yorkfolio/actions/workflows/ci.yml"><img src="https://github.com/rarrifano/yorkfolio/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.10%2B-blue" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/dependencies-none-brightgreen" alt="No dependencies">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT">
</p>

> **Prefer a native desktop app?** See [yorkfolio-qt](https://github.com/rarrifano/yorkfolio-qt), a Qt/PySide6 version with a C++ core.

Import the Excel exports from the B3 investor portal and YorkFolio shows:
- your positions with **preço médio**;
- **patrimônio and returns** over time, compared with CDI and Ibovespa;
- **proventos**.

It also suggests **aportes** that go to whatever is most below target, and prepares your **IR**:
the monthly DARF and the annual *Bens e Direitos*.

- **Zero dependencies**: Python 3.10+ standard library on the backend, plain JS/SVG on the frontend.
- **Self-hosted & private**: every account's data is a local SQLite file. Multi-user with login.
- **Market data**: Yahoo Finance (quotes and history), Tesouro Transparente (Tesouro prices),
  Banco Central SGS (CDI, Selic, IPCA, PTAX). No API keys.
- Light and dark themes, UI in Brazilian Portuguese.

## Quick start

### With Podman (recommended)

Run the published image (linux/amd64 and linux/arm64):

```bash
podman run -d --name yorkfolio -p 8000:8000 -v yorkfolio-data:/data ghcr.io/rarrifano/yorkfolio:0.1
```

Open http://localhost:8000 and **create the first account** (it becomes the administrator).
Everything is stored in the podman volume `yorkfolio-data`.

From a clone you can build it yourself, using the same volume:

```bash
git clone https://github.com/rarrifano/yorkfolio.git && cd yorkfolio
make up              # build the image, create the volume, run on http://localhost:8000
make service         # or: keep it running as a systemd user service (Quadlet)
make service IMAGE=ghcr.io/rarrifano/yorkfolio:0.1   # …using the published release instead of a local build
make volume-export   # back up the volume to yorkfolio-data-<timestamp>.tar
```

Already running with plain Python? `make volume-import` copies your `./data` into the volume.
Without `make`, use `podman compose up -d` (see `compose.yaml`).

### With plain Python

```bash
make run           # or: python3 run.py
```

The server listens on all interfaces (`0.0.0.0:8000`), so phones on your network can use it.
Use `make run HOST=127.0.0.1` to keep it local. It serves plain HTTP: see [SECURITY.md](SECURITY.md)
before exposing it beyond your home network.

### Importing your data

1. [investidor.b3.com.br](https://www.investidor.b3.com.br) → **Extratos** → **Movimentação** and
   **Negociação** → choose the period (more history is better) → download **Excel**.
2. Upload the files in the **Dados** tab, or run `make import FILES="movimentacao-*.xlsx negociacao-*.xlsx"`.

Re-importing the same files or overlapping periods is safe: rows already imported are skipped.
Assets outside B3 (US stocks/REITs, crypto, previdência) go in as **manual entries**.

## Features

| Tab | What it does |
| --- | --- |
| **Carteira** | Patrimônio by class over time with valor aplicado, cumulative return vs CDI and Ibovespa, allocation vs targets, positions with preço médio and P/L, closed positions |
| **Proventos** | Dividendos, JCP and rendimentos by month, year, type and asset; YoC 12m |
| **Balanceamento** | Target % per class and a *nota* per asset → "falta p/ meta" and an aporte plan in whole shares |
| **IR** | Monthly apuração (swing trade, day trade, FIIs), loss carry-forward, IRRF, DARF 6015 and due date; *Bens e Direitos* on 31/12 with copyable discriminação; rendimentos isentos and tributação exclusiva |
| **Extrato** | Every row and how it was interpreted (used, duplicate, ignored, day trade, unhandled) |
| **Dados** | B3 import, manual entries, filters (e.g. ignore CDBs), warnings, account and user management |

### Accounts

Each account has its own portfolio. The first account is the administrator and can create, reset or
remove others in **Dados → Usuários**. From the command line:

```bash
make user-add LOGIN=maria            # prompts for the password (ADMIN=1 for another admin)
make user-list
make user-passwd LOGIN=maria
make summary LOGIN=maria             # CLI commands accept LOGIN= when there are several accounts
```

Add `CT=1` to run any of these inside the running container. Upgrading from a single-user install
is automatic: the first account adopts the existing `data/yorkfolio.db`.

## Make targets

| | |
| --- | --- |
| `make run` / `make test` / `make check` | dev server / unit tests / lint + tests |
| `make lint` / `make format` | ruff + Biome checks / auto-fix and format |
| `make import` · `market` · `summary` · `aporte AMOUNT=…` · `ir YEAR=…` | portfolio CLI |
| `make backup` | consistent snapshot of every database into `<data>/backups/<timestamp>/` (`CT=1` inside the container) |
| `make build` · `up` · `down` · `restart` · `logs` · `shell` · `status` | container (podman) |
| `make volume-import` / `make volume-export` | copy `./data` into the `yorkfolio-data` volume / save it to a tarball |
| `make service` / `make service-remove` | systemd user service via Quadlet |

Run `make` to see them all. Inside a toolbox/distrobox, podman and systemctl automatically run on the host.

## How the numbers are computed

- **Trades**: Negociação is the source of truth (`ABEV3F` → `ABEV3`). Movimentação's
  *Transferência - Liquidação* rows (D+2 settlements) are matched to those trades by ticker, broker
  and net quantity. Matched rows are skipped; unmatched ones (periods missing from Negociação) become trades.
- **Day trade**: a buy and a sell of the same ticker on the same day at the same broker. The matched
  quantity closes at the day's average prices; only the remainder affects the position.
- **Preço médio**: weighted average cost.
  - *Bonificação* adds shares at cost R$ 0, because B3 doesn't report the assigned cost. Fix it
    with a manual *ajuste de custo*.
  - *Desdobro* and *Grupamento* change only the quantity.
  - *Restituição de capital* reduces the cost.
- **Renda fixa**:
  - Tesouro uses the official daily price.
  - CDB/LCI/LCA start from the last unit price reported by B3 and accrue by the indexer you
    configure: % CDI, % Selic, IPCA+ or prefixado.
  - A value you type in manually always wins.
- **Exterior & crypto**: USD entries are converted at the PTAX of their date (or the rate you type).
- **History**: one point per month end, using split-unadjusted monthly closes. Returns use
  Modified Dietz with exact flow dates. CDI and Ibovespa only count over the months you were invested.
- **Balanceamento** ("water-filling"): the aporte raises the most underweight class until it ties with
  the next one, and so on, without pushing any class past its target. The same happens inside each
  class using the notas. The result is rounded to whole shares.
- **IR**:
  - Swing trade is taxed at 15%. Shares (tickers ending in 3–8) are exempt when the month's share
    sales are ≤ R$ 20k. Units, ETFs and BDRs are never exempt (conservative for units).
  - Day trade and FIIs are taxed at 20%. Each of the three has its own loss carry-forward.
  - IRRF is deducted, and a DARF below R$ 10 rolls over to the next month.
  - Grupo/código in Bens e Direitos are suggestions. It's a support tool: double-check before filing.

## Development

```bash
make check     # ruff + Biome + unit tests (same as CI)
make format    # auto-fix and format
```

Python follows [ruff](https://docs.astral.sh/ruff/) (lint + formatter, 120 columns), JS/CSS follow
[Biome](https://biomejs.dev/). Both run without installing anything (podman image / `npx`). See
[CONTRIBUTING.md](CONTRIBUTING.md).

```
run.py                     CLI + server entry point
yorkfolio/b3.py            B3 export parsing & movement classification (xlsx.py: minimal reader)
yorkfolio/engine.py        ledger, positions (Book), carteira, proventos, balanceamento
yorkfolio/valuation.py     current & historical valuation (fixed_income.py: accrual math)
yorkfolio/history.py       monthly patrimônio, returns and benchmarks
yorkfolio/tax.py           IR: monthly apuração/DARF and annual report
yorkfolio/market.py        Yahoo / Banco Central / Tesouro fetchers
yorkfolio/auth.py          accounts, scrypt passwords, sessions
yorkfolio/db.py            SQLite schema, migrations, market-data cache
yorkfolio/service.py       glue for CLI and API · server.py: JSON API + static files
yorkfolio/static/          UI (index.html, app.js, style.css, logo.svg)
tests/                     unittest suite (synthetic data only)
```

## Not done yet

- IR on gains abroad (Lei 14.754/2023) and on crypto sales; brokerage fees from notas de corretagem
- Subscriptions (*direitos/recibos de subscrição*), incorporations and spin-offs (currently flagged as unhandled)
- HTTPS (use a reverse proxy)

## License

[MIT](LICENSE)
