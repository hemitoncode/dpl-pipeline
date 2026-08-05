"""Web frontend API tests (no network: bills point at local fixture files
via a monkeypatched fetch)."""

import time

import pytest

from conftest import FIXTURES

import dpl_pipeline.pipeline as pipeline_mod
from dpl_pipeline.fetch import FetchedDoc, FetchError
from dpl_pipeline.webapp import create_app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    def fake_fetch(url, cache_dir, offline=False):
        if url.startswith("fixture://"):
            name = url.removeprefix("fixture://")
            return FetchedDoc(url=url, content=(FIXTURES / name).read_bytes(),
                              content_type="text/html", from_cache=True)
        raise FetchError(f"no network in tests: {url}")

    monkeypatch.setattr(pipeline_mod, "fetch", fake_fetch)
    app = create_app(data_dir=tmp_path / "webdata")
    app.testing = True
    return app.test_client()


def _wait_for_job(client, job_id, timeout=15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").get_json()
        if job["state"] == "done":
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish in time")


def test_index_serves_ui(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"Voting Legislation Impact" in resp.data


def test_rules_endpoint(client):
    rules = client.get("/api/rules").get_json()
    assert len(rules) >= 30
    assert {"id", "category", "policy_area", "description"} <= set(rules[0])


def test_job_lifecycle_and_downloads(client):
    sheet = ("bill_number\turl\tstate_link\n"
             "VA HB 100\tfixture://mixed_bill.html\tfixture://mixed_bill.html\n"
             "XX HB 1\thttps://unreachable.test/x\t\n")
    resp = client.post("/api/jobs", json={"sheet": sheet})
    assert resp.status_code == 202
    job_id = resp.get_json()["job_id"]

    job = _wait_for_job(client, job_id)
    cats = {(r["bill_number"], r["category"]) for r in job["records"]}
    assert ("VA HB 100", "restrictive") in cats
    assert ("VA HB 100", "expansive") in cats
    assert ("XX HB 1", "unprocessed") in cats

    csv_resp = client.get(f"/api/jobs/{job_id}/impacts.csv")
    assert csv_resp.status_code == 200
    assert csv_resp.data.decode().startswith("bill_number,")
    jsonl_resp = client.get(f"/api/jobs/{job_id}/evidence.jsonl")
    assert jsonl_resp.status_code == 200


def test_bad_input_rejected(client):
    assert client.post("/api/jobs", json={"sheet": ""}).status_code == 400
    assert client.post("/api/jobs", json={"sheet": "wrong,columns\na,b\n"}).status_code == 400
    assert client.get("/api/jobs/nope").status_code == 404
