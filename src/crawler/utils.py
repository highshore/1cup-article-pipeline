from __future__ import annotations

import hashlib
import re
from urllib.parse import urlsplit, urlunsplit


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "article"


def normalize_url(url: str) -> str:
    parts = urlsplit(url.strip())
    normalized = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", ""))
    return normalized


def build_article_id(source: str, title: str, url: str) -> str:
    digest = hashlib.sha1(normalize_url(url).encode("utf-8")).hexdigest()[:10]
    return f"{slugify(source)}-{slugify(title)[:48]}-{digest}".strip("-")


def clean_text(value: str) -> str:
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\r\n?", "\n", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()
