"""SQLite storage: one table of JSON documents. Good for local development and demos."""

import json
import sqlite3
import threading
from pathlib import Path

from app.storage.base import Document

_SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    key        TEXT NOT NULL,
    body       TEXT NOT NULL,
    UNIQUE (collection, key)
);
"""


class SQLiteStorage:
    def __init__(self, path: str | Path) -> None:
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # FastAPI runs sync routes in a thread pool, so share one connection behind a lock.
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        with self._lock, self._conn:
            self._conn.executescript(_SCHEMA)

    def put(self, collection: str, key: str, document: Document) -> None:
        body = json.dumps(document, separators=(",", ":"))
        with self._lock, self._conn:
            # Delete + insert (instead of upsert) gives the document a fresh ``seq``,
            # which keeps "newest first" ordering correct after a rewrite.
            self._conn.execute(
                "DELETE FROM documents WHERE collection = ? AND key = ?", (collection, key)
            )
            self._conn.execute(
                "INSERT INTO documents (collection, key, body) VALUES (?, ?, ?)",
                (collection, key, body),
            )

    def get(self, collection: str, key: str) -> Document | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT body FROM documents WHERE collection = ? AND key = ?", (collection, key)
            ).fetchone()
        return _decode(row[0]) if row is not None else None

    def list(self, collection: str, *, limit: int = 100, offset: int = 0) -> list[Document]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT body FROM documents WHERE collection = ? "
                "ORDER BY seq DESC LIMIT ? OFFSET ?",
                (collection, limit, offset),
            ).fetchall()
        return [_decode(row[0]) for row in rows]

    def delete(self, collection: str, key: str) -> bool:
        with self._lock, self._conn:
            cursor = self._conn.execute(
                "DELETE FROM documents WHERE collection = ? AND key = ?", (collection, key)
            )
        return cursor.rowcount > 0

    def close(self) -> None:
        with self._lock:
            self._conn.close()


def _decode(body: str) -> Document:
    document: Document = json.loads(body)
    return document
