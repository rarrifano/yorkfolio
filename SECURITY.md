# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub Security Advisories](https://github.com/rarrifano/yorkfolio/security/advisories/new)
with steps to reproduce. You should get an answer within a few days.

## Deployment notes

YorkFolio is meant for personal use at home:

- It serves plain **HTTP**. To reach it from outside your network, put it behind a reverse proxy
  with TLS (Caddy, nginx, Traefik…) or a VPN (WireGuard, Tailscale); don't expose port 8000 directly.
- Accounts use scrypt password hashes and HttpOnly/SameSite session cookies, with throttling of
  repeated failed logins.
- All data stays in the `data/` directory (SQLite). Back it up with `make backup` and keep it private.
