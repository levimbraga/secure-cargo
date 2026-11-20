"""Storage backends behind a single interface (see ``base.Storage``)."""

from app.storage.base import Document, Storage
from app.storage.memory import MemoryStorage
from app.storage.sqlite import SQLiteStorage

__all__ = ["Document", "MemoryStorage", "SQLiteStorage", "Storage", "create_storage"]

_SQLITE_PREFIX = "sqlite:///"


def create_storage(url: str) -> Storage:
    """Build the storage backend selected by ``url``.

    Supported: ``memory://`` and ``sqlite:///<path>`` (``sqlite:///:memory:`` works too).
    """
    if url == "memory://":
        return MemoryStorage()
    if url.startswith(_SQLITE_PREFIX):
        return SQLiteStorage(url.removeprefix(_SQLITE_PREFIX))
    raise ValueError(f"Unsupported storage URL: {url!r}")
