"""Storage interface.

Everything the API persists (certificates, trips, cached photo analyses) goes through
this small document-store interface, so the backing database can be swapped without
touching the routes.
"""

from typing import Any, Protocol

Document = dict[str, Any]


class Storage(Protocol):
    """A minimal document store: JSON documents grouped in named collections."""

    def put(self, collection: str, key: str, document: Document) -> None:
        """Create or replace the document stored under ``key``."""
        ...

    def get(self, collection: str, key: str) -> Document | None:
        """Return the document stored under ``key``, or ``None`` if it does not exist."""
        ...

    def list(self, collection: str, *, limit: int = 100, offset: int = 0) -> list[Document]:
        """Return documents of a collection, newest first."""
        ...

    def delete(self, collection: str, key: str) -> bool:
        """Delete a document. Return ``True`` if it existed."""
        ...

    def close(self) -> None:
        """Release any underlying resources."""
        ...
