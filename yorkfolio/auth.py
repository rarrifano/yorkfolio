"""Simple multi-user support: accounts, scrypt password hashes and cookie sessions.

Data directory layout (YORKFOLIO_DATA, default ./data):
  auth.db          users + sessions
  users/<id>.db    one portfolio database per user (same schema as the single-user version)
The first account becomes admin and adopts a pre-existing single-user database
(data/yorkfolio.db or data/carteira.db), so nothing is lost when upgrading.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from . import db

COOKIE = "yf_session"
SESSION_DAYS = 30
MIN_PASSWORD = 6
_USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (           -- token is stored hashed (sha256)
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL
);
"""


class AuthError(Exception):
    """Authentication/authorization failure carrying an HTTP status."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def data_dir() -> Path:
    return Path(os.environ.get("YORKFOLIO_DATA") or db.DATA_DIR)


def connect() -> sqlite3.Connection:
    directory = data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(directory / "auth.db")
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    return con


def user_db_path(user_id: int) -> Path:
    return data_dir() / "users" / f"{user_id}.db"


def open_user_db(user_id: int) -> sqlite3.Connection:
    return db.connect(user_db_path(user_id))


# ------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return algo == "scrypt" and hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


_DUMMY_HASH: list[str] = []  # verified against unknown usernames so timing doesn't reveal them


def _dummy_hash() -> str:
    if not _DUMMY_HASH:
        _DUMMY_HASH.append(hash_password(secrets.token_hex(8)))
    return _DUMMY_HASH[0]


# ------------------------------------------------------------ users
def _public(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "created_at": row["created_at"],
    }


def _validate(username: str, password: str) -> str:
    username = (username or "").strip().lower()
    if not _USERNAME.match(username):
        raise ValueError("usuário inválido: 2 a 32 caracteres (letras minúsculas, números, ponto, hífen ou _)")
    if len(password or "") < MIN_PASSWORD:
        raise ValueError(f"senha muito curta (mínimo {MIN_PASSWORD} caracteres)")
    return username


def count_users(con) -> int:
    return con.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def list_users(con) -> list[dict]:
    return [_public(r) for r in con.execute("SELECT * FROM users ORDER BY username")]


def get_user(con, user_id: int) -> dict | None:
    row = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public(row) if row else None


def find_user(con, username: str) -> dict | None:
    row = con.execute("SELECT * FROM users WHERE username = ?", ((username or "").strip().lower(),)).fetchone()
    return _public(row) if row else None


def create_user(con, username: str, password: str, is_admin: bool = False) -> dict:
    """Create an account (+ its portfolio database). The first account is always admin and
    adopts a legacy single-user database if there is one."""
    username = _validate(username, password)
    first = count_users(con) == 0
    try:
        with con:
            cur = con.execute(
                "INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)",
                (username, hash_password(password), int(bool(is_admin) or first)),
            )
    except sqlite3.IntegrityError:
        raise ValueError("esse usuário já existe") from None
    path = user_db_path(cur.lastrowid)
    path.parent.mkdir(parents=True, exist_ok=True)
    if first and not path.exists():
        for legacy in (data_dir() / "yorkfolio.db", data_dir() / "carteira.db"):
            if legacy.exists():
                legacy.rename(path)
                break
    db.connect(path).close()  # create / migrate the schema
    return get_user(con, cur.lastrowid)


def set_password(con, user_id: int, password: str, keep_token: str | None = None) -> None:
    """Change a password and end the user's other sessions."""
    if len(password or "") < MIN_PASSWORD:
        raise ValueError(f"senha muito curta (mínimo {MIN_PASSWORD} caracteres)")
    with con:
        con.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(password), user_id))
        con.execute("DELETE FROM sessions WHERE user_id = ? AND token != ?", (user_id, _hash_token(keep_token or "")))


def delete_user(con, user_id: int) -> None:
    """Remove the account; its database is kept in users/deleted/ just in case."""
    with con:
        con.execute("DELETE FROM users WHERE id = ?", (user_id,))
    path = user_db_path(user_id)
    if path.exists():
        trash = path.parent / "deleted"
        trash.mkdir(exist_ok=True)
        path.rename(trash / f"{user_id}-{datetime.now():%Y%m%d-%H%M%S}.db")


def authenticate(con, username: str, password: str) -> dict | None:
    row = con.execute("SELECT * FROM users WHERE username = ?", ((username or "").strip().lower(),)).fetchone()
    if row is None:
        verify_password(password or "", _dummy_hash())
        return None
    return _public(row) if verify_password(password or "", row["password"]) else None


# ------------------------------------------------------------ sessions
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def create_session(con, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
    with con:
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (_now(),))
        con.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", (_hash_token(token), user_id, expires)
        )
    return token


def session_user(con, token: str | None) -> dict | None:
    if not token:
        return None
    row = con.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id " "WHERE s.token = ? AND s.expires_at > ?",
        (_hash_token(token), _now()),
    ).fetchone()
    return _public(row) if row else None


def delete_session(con, token: str | None) -> None:
    if token:
        with con:
            con.execute("DELETE FROM sessions WHERE token = ?", (_hash_token(token),))


# ------------------------------------------------------------ brute-force throttle (in memory)
_FAILURES: dict[str, list[float]] = {}
_LOCK = threading.Lock()
MAX_FAILURES, WINDOW = 10, 600.0


def throttled(key: str) -> bool:
    with _LOCK:
        recent = [t for t in _FAILURES.get(key, []) if t > time.time() - WINDOW]
        _FAILURES[key] = recent
        return len(recent) >= MAX_FAILURES


def record_failure(key: str) -> None:
    with _LOCK:
        _FAILURES.setdefault(key, []).append(time.time())


def clear_failures(key: str) -> None:
    with _LOCK:
        _FAILURES.pop(key, None)
