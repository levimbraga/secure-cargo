"""In-memory storage, used in tests and as a zero-setup fallback."""

import copy
import threading

from app.storage.base import Document


class MemoryStorage:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._collections: dict[str, dict[str, Document]] = {}

    def put(self, collection: str, key: str, document: Document) -> None:
        with self._lock:
            documents = self._collections.setdefault(collection, {})
            # Re-insert so that the most recently written document is last.
            documents.pop(key, None)
            documents[key] = copy.deepcopy(document)

    def get(self, collection: str, key: str) -> Document | None:
        with self._lock:
            document = self._collections.get(collection, {}).get(key)
            return copy.deepcopy(document) if document is not None else None

    def list(self, collection: str, *, limit: int = 100, offset: int = 0) -> list[Document]:
        with self._lock:
            newest_first = list(reversed(self._collections.get(collection, {}).values()))
            return copy.deepcopy(newest_first[offset : offset + limit])

    def delete(self, collection: str, key: str) -> bool:
        with self._lock:
            return self._collections.get(collection, {}).pop(key, None) is not None

    def close(self) -> None:
        with self._lock:
            self._collections.clear()
