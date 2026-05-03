"""
Integration tests for the python-api example. Hits a real Postgres —
the CI pipeline starts one as a service container.
"""
from fastapi.testclient import TestClient

from src.main import app


def test_healthz_pings_postgres():
    with TestClient(app) as client:
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


def test_create_item_persists_to_db():
    with TestClient(app) as client:
        r = client.post("/items", json={"name": "demo widget"})
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body["id"], int)
        assert body["name"] == "demo widget"


def test_create_item_rejects_empty_name():
    with TestClient(app) as client:
        r = client.post("/items", json={"name": "  "})
        assert r.status_code == 400


def test_list_items_returns_what_was_inserted():
    with TestClient(app) as client:
        client.post("/items", json={"name": "alpha"})
        client.post("/items", json={"name": "beta"})
        r = client.get("/items")
        assert r.status_code == 200
        names = [i["name"] for i in r.json()]
        assert "alpha" in names and "beta" in names
