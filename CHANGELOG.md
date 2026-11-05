# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-05

First release.

### Added

- **Import** of B3 "Área do Investidor" exports (Negociação and Movimentação):
  - settlement de-duplication, day-trade detection and fractional tickers;
  - corporate events (bonificação, desdobro, grupamento, restituição de capital);
  - idempotent re-imports.
- **Carteira**:
  - positions with preço médio, quotes and P/L;
  - patrimônio by class over time and cumulative return vs CDI and Ibovespa;
  - closed positions with realized results.
- **Proventos** by month, year, type and asset, with yield on cost.
- **Balanceamento**: class targets and per-asset *notas*, with an aporte plan in whole shares.
- **IR**:
  - monthly apuração (swing trade, day trade, FIIs) with loss carry-forward, IRRF and DARF;
  - *Bens e Direitos* on 31/12, rendimentos isentos and tributação exclusiva.
- **Renda fixa valuation**: official Tesouro prices, plus CDI, Selic, IPCA+ and prefixado accrual for CDB/LCI/LCA.
- **Manual entries** for assets outside B3 (USD at PTAX, crypto), cost adjustments, and filters (e.g. ignore CDBs).
- **Accounts**: multiple users with login (scrypt, session cookies, admin user management), one portfolio each.
- Light and dark themes, and the Yorkshire logo.
- **Container image** for linux/amd64 and linux/arm64, with Makefile targets for podman volumes and a systemd service (Quadlet).
- **Development**: ruff and Biome code style, unit tests, GitHub Actions CI.

[0.1.0]: https://github.com/rarrifano/yorkfolio/releases/tag/v0.1.0
