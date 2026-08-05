"""Split extracted bill text into provisions.

A "provision" here is a section-level unit: rules are evaluated per
provision so that (a) evidence excerpts point at the specific section that
triggered a category, and (b) proximity windows in rule regexes cannot
accidentally span unrelated sections.

Strategy:
1. Split on statutory section markers ("SECTION 1.", "Sec. 3.", "§ 24.2-643",
   "Be it enacted").
2. If no markers are found (common for flat PDF extractions), fall back to
   fixed-size paragraph chunks so long texts are still windowed.
"""

from __future__ import annotations

import re

from .models import Provision

# Line-anchored section markers.
_SECTION_RE = re.compile(
    r"^(?:"
    r"(?:SECTION|Section|Sec\.)\s+\d+[A-Za-z]?\s*[.:]"   # SECTION 1. / Sec. 2:
    r"|§+\s*[\d.]+[-\d.A-Za-z:]*"                    # § 24.2-643
    r"|Be it enacted\b"
    r")",
    re.MULTILINE,
)

_FALLBACK_CHUNK_CHARS = 2500
_MIN_PROVISION_CHARS = 40


def segment(text: str) -> list[Provision]:
    starts = [m.start() for m in _SECTION_RE.finditer(text)]
    if len(starts) >= 2:
        bounds = starts + [len(text)]
        chunks = []
        if starts[0] > 0:
            chunks.append(text[: starts[0]])  # preamble / title
        chunks.extend(text[bounds[i]: bounds[i + 1]] for i in range(len(starts)))
    else:
        chunks = _fallback_chunks(text)

    provisions: list[Provision] = []
    for chunk in chunks:
        chunk = chunk.strip()
        if len(chunk) < _MIN_PROVISION_CHARS:
            continue
        heading = chunk.split("\n", 1)[0][:120]
        provisions.append(
            Provision(
                provision_id=f"P{len(provisions) + 1:03d}",
                heading=heading,
                text=chunk,
            )
        )
    if not provisions and text.strip():
        provisions.append(Provision("P001", text.strip().split("\n", 1)[0][:120], text.strip()))
    return provisions


def _fallback_chunks(text: str) -> list[str]:
    paragraphs = re.split(r"\n\s*\n", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        if current and len(current) + len(para) > _FALLBACK_CHUNK_CHARS:
            chunks.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks
