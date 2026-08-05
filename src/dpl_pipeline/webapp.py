"""Web frontend: submit a bill sheet, watch progress, review Impact/Bill records.

Flask app with a small JSON API and a single-page UI:

    POST /api/jobs            start a classification job (TSV/CSV text or file)
    GET  /api/jobs/<id>       job status, per-bill progress, records when done
    GET  /api/jobs/<id>/impacts.csv    download the coding dataset
    GET  /api/jobs/<id>/evidence.jsonl download full evidence detail
    GET  /api/rules           rule lexicon summary (transparency view)

Jobs run in a background thread; the UI polls for progress. Job state is
in-memory (per server process) — outputs are also written under the job's
output directory so nothing is lost if the browser goes away.
"""

from __future__ import annotations

import csv
import io
import threading
import uuid
from dataclasses import asdict
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request

from .aggregate import aggregate
from .models import ImpactRecord
from .output import write_outputs
from .pipeline import process_bill, read_input
from .rules import Rule, default_rules_path, load_rules

_JOBS: dict[str, dict] = {}
_LOCK = threading.Lock()


def _parse_sheet(text: str):
    """read_input over an in-memory string (delimiter sniffed)."""
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False, encoding="utf-8") as f:
        f.write(text)
        tmp = f.name
    try:
        return read_input(tmp)
    finally:
        Path(tmp).unlink(missing_ok=True)


def _record_dict(r: ImpactRecord) -> dict:
    d = asdict(r)
    d["policy_areas"] = list(r.policy_areas)
    d["rule_ids"] = list(r.rule_ids)
    d["evidence"] = [
        dict(zip(("provision_id", "rule_id", "excerpt"), e.split("|", 2))) for e in r.evidence
    ]
    return d


def _run_job(job_id: str, bills, rules: list[Rule], cache_dir: Path, out_dir: Path,
             offline: bool) -> None:
    records: list[ImpactRecord] = []
    for i, bill in enumerate(bills):
        with _LOCK:
            _JOBS[job_id]["progress"] = {
                "current": bill.bill_number, "done": i, "total": len(bills),
            }
        try:
            result = process_bill(bill, rules, cache_dir, offline=offline)
        except Exception as e:  # never let one bill kill the job
            from .models import BillResult
            result = BillResult(bill=bill, status="fetch_error", error=str(e))
        bill_records = aggregate(result)
        records.extend(bill_records)
        with _LOCK:
            _JOBS[job_id]["bills"].append(
                {
                    "bill_number": bill.bill_number,
                    "status": result.status,
                    "error": result.error,
                    "categories": [r.category for r in bill_records],
                }
            )
    write_outputs(records, out_dir)
    with _LOCK:
        _JOBS[job_id]["state"] = "done"
        _JOBS[job_id]["progress"] = {"current": "", "done": len(bills), "total": len(bills)}
        _JOBS[job_id]["records"] = [_record_dict(r) for r in records]


def create_app(rules_path: str | Path | None = None,
               data_dir: str | Path = "webdata",
               offline: bool = False) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # input sheets are tiny
    rules = load_rules(rules_path or default_rules_path())
    data_dir = Path(data_dir)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/rules")
    def api_rules():
        return jsonify(
            [
                {
                    "id": r.rule_id,
                    "category": r.category,
                    "policy_area": r.policy_area,
                    "description": r.description,
                }
                for r in rules
            ]
        )

    @app.post("/api/jobs")
    def api_create_job():
        if "file" in request.files and request.files["file"].filename:
            sheet = request.files["file"].read().decode("utf-8-sig")
        else:
            sheet = (request.get_json(silent=True) or {}).get("sheet", "")
        if not sheet.strip():
            return jsonify({"error": "no input provided"}), 400
        try:
            bills = _parse_sheet(sheet)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if not bills:
            return jsonify({"error": "no bills found in input"}), 400

        job_id = uuid.uuid4().hex[:12]
        out_dir = data_dir / "jobs" / job_id
        cache_dir = data_dir / "cache"
        with _LOCK:
            _JOBS[job_id] = {
                "state": "running",
                "progress": {"current": "", "done": 0, "total": len(bills)},
                "bills": [],
                "records": None,
            }
        t = threading.Thread(
            target=_run_job, args=(job_id, bills, rules, cache_dir, out_dir, offline),
            daemon=True,
        )
        t.start()
        return jsonify({"job_id": job_id, "n_bills": len(bills)}), 202

    @app.get("/api/jobs/<job_id>")
    def api_job(job_id: str):
        with _LOCK:
            job = _JOBS.get(job_id)
            if job is None:
                return jsonify({"error": "unknown job"}), 404
            return jsonify(job)

    @app.get("/api/jobs/<job_id>/impacts.csv")
    def api_job_csv(job_id: str):
        path = data_dir / "jobs" / job_id / "impacts.csv"
        if not path.exists():
            return jsonify({"error": "not ready"}), 404
        return Response(
            path.read_text(encoding="utf-8"),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename=impacts-{job_id}.csv"},
        )

    @app.get("/api/jobs/<job_id>/evidence.jsonl")
    def api_job_jsonl(job_id: str):
        path = data_dir / "jobs" / job_id / "evidence.jsonl"
        if not path.exists():
            return jsonify({"error": "not ready"}), 404
        return Response(
            path.read_text(encoding="utf-8"),
            mimetype="application/jsonl",
            headers={"Content-Disposition": f"attachment; filename=evidence-{job_id}.jsonl"},
        )

    return app


def serve(host: str = "127.0.0.1", port: int = 8000, **kwargs) -> None:
    create_app(**kwargs).run(host=host, port=port, debug=False)
