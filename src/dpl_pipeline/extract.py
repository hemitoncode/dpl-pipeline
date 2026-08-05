"""Text extraction from fetched documents (HTML or PDF).

HTML handling notes:
- Stricken language (``<s>``, ``<strike>``, ``<del>``) is *removed* before
  extraction. In enrolled/chaptered bill texts, struck-through language is
  the law being deleted; classifying it as if it were enacted would invert
  the meaning of amendments (e.g. striking a restriction is expansive, not
  restrictive).
- Script/style/nav chrome is dropped.

PDF text is extracted per page with pypdf and joined with newlines.
"""

from __future__ import annotations

import io
import re

from bs4 import BeautifulSoup
from pypdf import PdfReader

from .fetch import FetchedDoc


class ExtractError(RuntimeError):
    pass


def is_pdf(doc: FetchedDoc) -> bool:
    return doc.content[:5] == b"%PDF-" or "pdf" in doc.content_type.lower()


def extract_text(doc: FetchedDoc) -> str:
    if is_pdf(doc):
        text = _extract_pdf(doc.content)
    else:
        text = _extract_html(doc.content)
    text = _normalize(text)
    if len(text) < 200:
        raise ExtractError(
            f"extracted only {len(text)} chars from {doc.url}; "
            "page is likely a viewer shell, redirect, or scanned image PDF"
        )
    return text


def _extract_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as e:  # pypdf raises a wide range of exception types
        raise ExtractError(f"PDF extraction failed: {e}") from e
    return "\n".join(pages)


def _extract_html(content: bytes) -> str:
    soup = BeautifulSoup(content, "html.parser")
    # Drop non-content elements and stricken (deleted) statutory language.
    for tag in soup.find_all(["script", "style", "nav", "header", "footer",
                              "s", "strike", "del"]):
        tag.decompose()
    return soup.get_text("\n")


def _normalize(text: str) -> str:
    """Collapse whitespace while keeping line structure for segmentation."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\xa0]+", " ", text)
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
