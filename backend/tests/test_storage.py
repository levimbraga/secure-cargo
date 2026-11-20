from collections.abc import Iterator
from pathlib import Path

import pytest

from app.storage import MemoryStorage, SQLiteStorage, Storage, create_storage


@pytest.fixture(params=["memory", "sqlite"])
def storage(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Storage]:
    backend: Storage
    if request.param == "memory":
        backend = MemoryStorage()
    else:
        backend = SQLiteStorage(tmp_path / "nested" / "test.db")
    yield backend
    backend.close()


def test_get_returns_none_for_a_missing_document(storage: Storage) -> None:
    assert storage.get("certificates", "missing") is None


def test_put_then_get_round_trips_the_document(storage: Storage) -> None:
    document = {"id": "c1", "units": [{"mass_kg": 1200.5}], "passed": True, "note": None}

    storage.put("certificates", "c1", document)

    assert storage.get("certificates", "c1") == document


def test_put_replaces_an_existing_document(storage: Storage) -> None:
    storage.put("certificates", "c1", {"revision": 1})
    storage.put("certificates", "c1", {"revision": 2})

    assert storage.get("certificates", "c1") == {"revision": 2}
    assert storage.list("certificates") == [{"revision": 2}]


def test_collections_are_isolated(storage: Storage) -> None:
    storage.put("certificates", "x", {"kind": "certificate"})
    storage.put("trips", "x", {"kind": "trip"})

    assert storage.get("certificates", "x") == {"kind": "certificate"}
    assert storage.get("trips", "x") == {"kind": "trip"}


def test_list_is_newest_first_and_paginates(storage: Storage) -> None:
    for index in range(5):
        storage.put("trips", f"t{index}", {"index": index})
    storage.put("trips", "t1", {"index": 1})  # rewriting makes it the newest

    assert [d["index"] for d in storage.list("trips")] == [1, 4, 3, 2, 0]
    assert [d["index"] for d in storage.list("trips", limit=2, offset=1)] == [4, 3]


def test_delete_reports_whether_the_document_existed(storage: Storage) -> None:
    storage.put("trips", "t1", {"index": 1})

    assert storage.delete("trips", "t1") is True
    assert storage.delete("trips", "t1") is False
    assert storage.get("trips", "t1") is None


def test_stored_documents_are_not_aliased(storage: Storage) -> None:
    document = {"units": [1, 2]}
    storage.put("trips", "t1", document)
    document["units"].append(3)

    assert storage.get("trips", "t1") == {"units": [1, 2]}


def test_sqlite_persists_across_connections(tmp_path: Path) -> None:
    path = tmp_path / "persist.db"
    first = SQLiteStorage(path)
    first.put("certificates", "c1", {"id": "c1"})
    first.close()

    second = SQLiteStorage(path)
    assert second.get("certificates", "c1") == {"id": "c1"}
    second.close()


def test_create_storage_selects_the_backend_from_the_url(tmp_path: Path) -> None:
    assert isinstance(create_storage("memory://"), MemoryStorage)
    assert isinstance(create_storage(f"sqlite:///{tmp_path / 'a.db'}"), SQLiteStorage)
    assert isinstance(create_storage("sqlite:///:memory:"), SQLiteStorage)


def test_create_storage_rejects_unknown_urls() -> None:
    with pytest.raises(ValueError, match="Unsupported storage URL"):
        create_storage("postgres://localhost/securecargo")
