#!/usr/bin/env python3
"""YorkFolio — simple holder-style portfolio tracker for B3 investors (stdlib only).

  python3 run.py                          start the web UI on port 8000 (all interfaces: 0.0.0.0)
  python3 run.py serve --port 8080        same, custom port (--host 127.0.0.1 for this machine only)
  python3 run.py user add NAME [--admin]  create an account (the first one is admin)
  python3 run.py user list | passwd NAME | del NAME
  python3 run.py [--user NAME] import FILE.xlsx ...   import B3 Negociação / Movimentação exports
  python3 run.py [--user NAME] market [--force]       refresh quotes, history, Tesouro and BCB data
  python3 run.py [--user NAME] summary | aporte 5000 | ir [YEAR]

--user can be omitted when there is a single account.
Data lives in ./data (auth.db + users/<id>.db); set YORKFOLIO_DATA to use another directory.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

from yorkfolio import auth, service


def brl(v) -> str:
    if v is None:
        return "-"
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


def pct(v) -> str:
    return "-" if v is None else f"{v * 100:.1f}%".replace(".", ",")


# ------------------------------------------------------------ portfolio commands
def cmd_import(con, args):
    for f in args.files:
        try:
            r = service.import_file(con, Path(f).name, Path(f).read_bytes())
            print(
                f"{r['file']}: {r['kind']} — {r['rows']} linhas, {r['inserted']} novas, {r['duplicates']} já existentes"
            )
        except (OSError, ValueError) as exc:
            print(f"{f}: ERRO — {exc}", file=sys.stderr)


def cmd_market(con, args):
    r = service.refresh_market(con, force=args.force)
    for code, price in sorted(r["updated"].items()):
        print(f"  {code:<10} {price:,.2f}")
    for what, err in sorted({**r["errors"], **r["warnings"]}.items()):
        print(f"  {what}: falhou — {err}", file=sys.stderr)


def cmd_summary(con, _args):
    st = service.state(con)
    s = st["summary"]
    print(
        f"Patrimônio {brl(s['value'])} | Custo {brl(s['cost'])} | Resultado {brl(s['pnl'])} ({pct(s['pnl_pct'])})"
        f" | Proventos 12m {brl(s['proventos_12m'])} | total {brl(s['proventos_total'])}"
    )
    for c in st["classes"]:
        if not c["assets"]:
            continue
        meta = f" meta {pct(c['target'])}" if s["targets_set"] else ""
        print(f"\n== {c['name']}: {brl(c['value'])} ({pct(c['pct'])}{meta})")
        for a in c["assets"]:
            qty = f"{a['qty']:g}" if a["quoted"] else ""
            print(
                f"  {a['code']:<22} {qty:>8}  custo {brl(a['cost']):>14}  valor {brl(a['value']):>14}"
                f"  {pct(a['pnl_pct']):>7}  [{a['source']}] {a['source_note']}"
            )
    for w in st["warnings"]:
        print(f"[{w['level']}] {w['date']} {w['code']}: {w['msg']}")


def cmd_aporte(con, args):
    plan = service.aporte(con, args.amount)
    for c in plan["classes"]:
        print(f"{c['class']}: {brl(c['spent'])}" + (f"  ({c['note']})" if c.get("note") else ""))
        for a in c["assets"]:
            qty = f"{a['qty']} x {brl(a['price'])}" if a["qty"] is not None else ""
            print(f"   {a['code']:<10} {qty:<22} = {brl(a['amount'])}")
    print(f"Sobra: {brl(plan['leftover'])}")


def cmd_ir(con, args):
    rep = service.ir(con, args.year)
    print(f"== Apuração mensal {rep['year']} (renda variável B3)")
    for m in rep["months"]:
        cats = " | ".join(f"{k} {brl(v['result'])}" for k, v in m["categories"].items() if v["result"])
        isento = f" | isento {brl(m['exempt_gain'])}" if m["exempt_gain"] else ""
        darf = f" | DARF {brl(m['darf'])} vence {m['due_date']}" if m["darf"] else ""
        print(f"  {m['month']}: vendas de ações {brl(m['share_sales'])}{isento} | {cats or 'sem resultado'}{darf}")
    if not rep["months"]:
        print("  nenhuma venda de renda variável no ano")
    print(f"\n== Bens e Direitos em 31/12/{rep['year']}")
    for b in rep["bens"]:
        code = f"{b['group']}/{b['group_code'] or '?'}"
        print(f"  [{code}] {b['code']:<20} {brl(b['prev']):>14} → {brl(b['cur']):>14}  {b['discriminacao']}")
    sections = (
        ("Rendimentos isentos", rep["isentos"]),
        ("Tributação exclusiva", rep["exclusivos"]),
        ("Outros", rep["outros"]),
    )
    for title, rows in sections:
        if rows:
            print(f"\n== {title}")
            for r in rows:
                print(f"  [{r['code'] or '-'}] {r['asset'] or r['type']:<14} {brl(r['value']):>12}  {r['label']}")


# ------------------------------------------------------------ accounts
def cmd_backup():
    """Consistent copies (SQLite online backup) of auth.db and every user database."""
    import sqlite3
    from datetime import datetime

    src = auth.data_dir()
    dst = src / "backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    dbs = [p for p in [src / "auth.db", *sorted((src / "users").glob("*.db"))] if p.exists()]
    for path in dbs:
        target = dst / path.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as source, sqlite3.connect(target) as copy:
            source.backup(copy)
    print(f"{len(dbs)} banco(s) copiado(s) para {dst}")


def _password(args, prompt="Senha: ") -> str:
    if args.password:
        return args.password
    first = getpass.getpass(prompt)
    if getpass.getpass("Confirme: ") != first:
        sys.exit("erro: as senhas não conferem")
    return first


def cmd_user(acon, args):
    if args.action == "list":
        for u in auth.list_users(acon):
            print(f"  {u['username']:<20} {'admin' if u['is_admin'] else '':<6} criado em {u['created_at']}")
        return
    if not args.name:
        sys.exit(f"erro: informe o usuário: run.py user {args.action} NOME")
    if args.action == "add":
        u = auth.create_user(acon, args.name, _password(args), args.admin)
        print(f"usuário {u['username']} criado{' (admin)' if u['is_admin'] else ''}")
        return
    user = auth.find_user(acon, args.name)
    if not user:
        sys.exit(f"erro: usuário {args.name} não encontrado")
    if args.action == "passwd":
        auth.set_password(acon, user["id"], _password(args, "Nova senha: "))
        print("senha alterada (outras sessões encerradas)")
    elif args.action == "del":
        auth.delete_user(acon, user["id"])
        print(f"usuário {user['username']} excluído (banco movido para users/deleted/)")


def resolve_user(acon, name: str | None) -> dict:
    if name:
        user = auth.find_user(acon, name)
        if not user:
            sys.exit(f"erro: usuário {name} não encontrado")
        return user
    users = auth.list_users(acon)
    if len(users) == 1:
        return users[0]
    if not users:
        sys.exit("erro: nenhuma conta ainda — crie uma com: python3 run.py user add NOME")
    sys.exit("erro: há mais de uma conta — use --user NOME")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", help="account to use (optional when there is only one)")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("serve", help="start the web UI")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p = sub.add_parser("user", help="manage accounts")
    p.add_argument("action", choices=["add", "list", "passwd", "del"])
    p.add_argument("name", nargs="?")
    p.add_argument("--admin", action="store_true", help="(add) make the account an administrator")
    p.add_argument("--password", help="non-interactive password (prefer the prompt)")
    p = sub.add_parser("import", help="import B3 .xlsx exports")
    p.add_argument("files", nargs="+")
    p = sub.add_parser("market", aliases=["quotes"], help="refresh market data")
    p.add_argument("--force", action="store_true", help="also refetch cached history")
    sub.add_parser("summary", help="print the portfolio")
    p = sub.add_parser("aporte", help="suggest how to invest an amount")
    p.add_argument("amount", type=float)
    p = sub.add_parser("ir", help="IR report")
    p.add_argument("year", nargs="?", type=int)
    sub.add_parser("backup", help="snapshot every database into data/backups/<timestamp>/")
    args = parser.parse_args(argv)
    if args.cmd in (None, "serve"):
        from yorkfolio.server import serve

        return serve(getattr(args, "host", "0.0.0.0"), getattr(args, "port", 8000))
    if args.cmd == "backup":
        return cmd_backup()

    acon = auth.connect()
    try:
        if args.cmd == "user":
            return cmd_user(acon, args)
        handlers = {
            "import": cmd_import,
            "market": cmd_market,
            "quotes": cmd_market,
            "summary": cmd_summary,
            "aporte": cmd_aporte,
            "ir": cmd_ir,
        }
        con = auth.open_user_db(resolve_user(acon, args.user)["id"])
        try:
            handlers[args.cmd](con, args)
        finally:
            con.close()
    except ValueError as exc:
        sys.exit(f"erro: {exc}")
    finally:
        acon.close()


if __name__ == "__main__":
    main()
