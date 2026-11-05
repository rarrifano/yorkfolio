"""Tiny JSON API + static file server (stdlib http.server) with cookie sessions."""

from __future__ import annotations

import json
import mimetypes
import signal
import sys
import time
import traceback
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__, auth, db, service
from .auth import AuthError
from .b3 import parse_num

STATIC = Path(__file__).resolve().parent / "static"
MAX_UPLOAD = 20 * 1024 * 1024


def _number(value, field):
    if value is None or value == "":
        return None
    number = parse_num(value)  # accepts 1234.5, "1234,5" and "1.234,50"
    if number is None:
        raise ValueError(f"{field}: número inválido")
    return number


class Handler(BaseHTTPRequestHandler):
    server_version = f"YorkFolio/{__version__}"
    user: dict | None = None
    acon = None  # auth database connection for the current request

    # ------------------------------------------------------------ plumbing
    def log_message(self, fmt, *args):  # keep the console quiet except for errors
        if not str(args[1] if len(args) > 1 else "").startswith(("2", "3")):
            super().log_message(fmt, *args)

    def _send(self, status, body: bytes, content_type: str, headers: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, status=HTTPStatus.OK):
        headers = {}
        if isinstance(obj, dict) and "_cookie" in obj:  # login / logout set the session cookie
            obj = dict(obj)
            token = obj.pop("_cookie")
            age = auth.SESSION_DAYS * 86400 if token else 0
            headers["Set-Cookie"] = f"{auth.COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}"
        body = json.dumps(obj, ensure_ascii=False).encode()
        self._send(status, body, "application/json; charset=utf-8", headers)

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_UPLOAD:
            raise ValueError("arquivo muito grande")
        return self.rfile.read(length) if length else b""

    def _payload(self) -> dict:
        if not hasattr(self, "_cached_payload"):
            body = self._body()
            self._cached_payload = json.loads(body) if body else {}
        return self._cached_payload

    def _query(self) -> dict:
        return {k: v[-1] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie") or "")
        return cookie[auth.COOKIE].value if auth.COOKIE in cookie else None

    def _static(self, name: str):
        path = (STATIC / name).resolve()
        if not path.is_file() or STATIC not in path.parents:
            return self._json({"error": "não encontrado"}, HTTPStatus.NOT_FOUND)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith(("javascript", "svg+xml")):
            ctype += "; charset=utf-8"
        self._send(HTTPStatus.OK, path.read_bytes(), ctype)

    def _dispatch(self, public: dict, private: dict):
        path = urlparse(self.path).path
        con = None
        try:
            if path in public or path in private:
                self.acon = auth.connect()
                if path in public:
                    return self._json(public[path]())
                self.user = auth.session_user(self.acon, self._token())
                if not self.user:
                    raise AuthError(401, "não autenticado")
                con = auth.open_user_db(self.user["id"])
                return self._json(private[path](con))
            if self.command == "GET" and path in ("/", "/index.html"):
                return self._static("index.html")
            if self.command == "GET" and path == "/favicon.ico":
                return self._static("logo.svg")
            if self.command == "GET" and path.startswith("/static/"):
                return self._static(unquote(path[len("/static/") :]))
            self._json({"error": "não encontrado"}, HTTPStatus.NOT_FOUND)
        except AuthError as exc:
            self._json({"error": str(exc)}, exc.status)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # pragma: no cover - surfaced to the UI
            traceback.print_exc()
            self._json({"error": f"erro interno: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
        finally:
            for c in (con, self.acon):
                if c is not None:
                    c.close()

    # ------------------------------------------------------------ routes
    def do_GET(self):
        self._dispatch(
            {"/api/session": self.session},
            {
                "/api/state": service.state,
                "/api/ir": lambda con: service.ir(con, self._query().get("year")),
                "/api/users": lambda con: self._admin() or auth.list_users(self.acon),
            },
        )

    def do_POST(self):
        self._dispatch(
            {"/api/login": self.login, "/api/setup": self.first_account, "/api/logout": self.logout},
            {
                "/api/import": self.import_file,
                "/api/market": lambda con: service.refresh_market(con, bool(self._payload().get("force"))),
                "/api/asset": self.update_asset,
                "/api/asset/delete": lambda con: db.delete_asset_settings(con, self._payload()["code"]) or {"ok": True},
                "/api/targets": self.set_targets,
                "/api/aporte": lambda con: service.aporte(con, _number(self._payload().get("amount"), "aporte") or 0),
                "/api/manual": lambda con: service.add_manual(con, self._payload()),
                "/api/manual/delete": lambda con: db.delete_manual(con, int(self._payload()["id"])) or {"ok": True},
                "/api/filters": lambda con: service.set_filters(con, self._payload().get("exclude") or []),
                "/api/reset": lambda con: db.reset(con, bool(self._payload().get("everything"))) or {"ok": True},
                "/api/password": self.change_password,
                "/api/users": self.create_user,
                "/api/users/delete": self.delete_user,
                "/api/users/password": self.reset_password,
            },
        )

    # ------------------------------------------------------------ session
    def session(self):
        return {"user": auth.session_user(self.acon, self._token()), "setup": auth.count_users(self.acon) == 0}

    def login(self):
        data, ip = self._payload(), self.client_address[0]
        if auth.throttled(ip):
            raise AuthError(429, "muitas tentativas; aguarde alguns minutos")
        user = auth.authenticate(self.acon, data.get("username"), data.get("password"))
        if not user:
            auth.record_failure(ip)
            time.sleep(0.5)
            raise AuthError(401, "usuário ou senha inválidos")
        auth.clear_failures(ip)
        return {"user": user, "_cookie": auth.create_session(self.acon, user["id"])}

    def first_account(self):  # NB: not `setup` — that name belongs to socketserver's request lifecycle
        if auth.count_users(self.acon):
            raise AuthError(403, "a conta inicial já foi criada")
        data = self._payload()
        user = auth.create_user(self.acon, data.get("username"), data.get("password"), is_admin=True)
        return {"user": user, "_cookie": auth.create_session(self.acon, user["id"])}

    def logout(self):
        auth.delete_session(self.acon, self._token())
        return {"ok": True, "_cookie": ""}

    def change_password(self, _con):
        data = self._payload()
        if not auth.authenticate(self.acon, self.user["username"], data.get("current")):
            raise AuthError(403, "senha atual incorreta")
        auth.set_password(self.acon, self.user["id"], data.get("new"), keep_token=self._token())
        return {"ok": True}

    # ------------------------------------------------------------ users (admin)
    def _admin(self):
        if not self.user["is_admin"]:
            raise AuthError(403, "apenas administradores")

    def create_user(self, _con):
        self._admin()
        data = self._payload()
        return auth.create_user(self.acon, data.get("username"), data.get("password"), bool(data.get("is_admin")))

    def delete_user(self, _con):
        self._admin()
        user_id = int(self._payload()["id"])
        if user_id == self.user["id"]:
            raise ValueError("você não pode excluir a própria conta")
        auth.delete_user(self.acon, user_id)
        return {"ok": True}

    def reset_password(self, _con):
        self._admin()
        data = self._payload()
        auth.set_password(self.acon, int(data["id"]), data.get("password"))
        return {"ok": True}

    # ------------------------------------------------------------ portfolio
    def import_file(self, con):
        name = unquote(self.headers.get("X-Filename") or "upload.xlsx")
        return service.import_file(con, name, self._body())

    def update_asset(self, con):
        data = dict(self._payload())
        code = str(data.pop("code", "")).strip()  # exact code (fixed income codes are case-sensitive)
        if not code:
            raise ValueError("código do ativo obrigatório")
        for field in ("nota", "manual_price", "manual_value", "rate"):
            if field in data:
                data[field] = _number(data[field], field)
        db.update_asset(con, code, data)
        return {"ok": True}

    def set_targets(self, con):
        targets = {k: _number(v, k) or 0 for k, v in self._payload().get("targets", {}).items()}
        db.set_targets(con, targets)
        return {"ok": True}


def _lan_ip() -> str | None:
    """Best-effort LAN address (no packets are sent)."""
    import socket

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def make_server(host: str = "0.0.0.0", port: int = 8000) -> ThreadingHTTPServer:
    auth.connect().close()  # create the auth schema early
    return ThreadingHTTPServer((host, port), Handler)


def serve(host: str = "0.0.0.0", port: int = 8000):
    def stop(*_):  # `podman stop` sends SIGTERM; as PID 1 Python would otherwise ignore it
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    httpd = make_server(host, port)
    if host in ("0.0.0.0", ""):
        lan = _lan_ip()
        where = f"http://localhost:{port}" + (f" e na rede em http://{lan}:{port}" if lan else "")
    else:
        where = f"http://{host}:{port}"
    print(f"YorkFolio rodando em {where}  (Ctrl+C para sair)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nAté logo!", file=sys.stderr)
    finally:
        httpd.server_close()
