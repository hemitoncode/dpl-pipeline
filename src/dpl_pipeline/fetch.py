"""Document fetching with an on-disk cache.

Every fetched document is cached under sha256(url); reruns are fully
reproducible (and offline-capable) once the cache is warm. Cache metadata
records the content type, byte hash, and fetch timestamp so a run can be
audited later.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path

import requests

USER_AGENT = (
    "dpl-pipeline/0.1 (legislative research; contact repository owner)"
)
TIMEOUT = 60
RETRIES = 3


@dataclass(frozen=True)
class FetchedDoc:
    url: str
    content: bytes
    content_type: str
    from_cache: bool

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


class FetchError(RuntimeError):
    pass


def _cache_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def fetch(url: str, cache_dir: str | Path, offline: bool = False) -> FetchedDoc:
    """Fetch `url`, preferring the cache. In offline mode, cache misses raise."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = _cache_key(url)
    body_path = cache_dir / f"{key}.bin"
    meta_path = cache_dir / f"{key}.json"

    if body_path.exists() and meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return FetchedDoc(
            url=url,
            content=body_path.read_bytes(),
            content_type=meta.get("content_type", ""),
            from_cache=True,
        )

    if offline:
        raise FetchError(f"offline mode and no cache entry for {url}")

    last_err: Exception | None = None
    for attempt in range(RETRIES):
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": USER_AGENT},
                timeout=TIMEOUT,
                allow_redirects=True,
            )
            resp.raise_for_status()
            content = resp.content
            content_type = resp.headers.get("Content-Type", "")
            body_path.write_bytes(content)
            meta_path.write_text(
                json.dumps(
                    {
                        "url": url,
                        "content_type": content_type,
                        "sha256": hashlib.sha256(content).hexdigest(),
                        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "status_code": resp.status_code,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
            return FetchedDoc(url=url, content=content, content_type=content_type, from_cache=False)
        except requests.RequestException as e:
            last_err = e
            if attempt < RETRIES - 1:
                time.sleep(2 ** attempt)  # 1s, 2s backoff between attempts
    raise FetchError(f"failed to fetch {url}: {last_err}")
