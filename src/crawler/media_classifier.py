from __future__ import annotations

import io
import re
from dataclasses import dataclass

import pytesseract
from PIL import Image, ImageEnhance, ImageOps

from .utils import clean_text


CHART_HINT_RE = re.compile(r"\b(chart|graph|table|diagram|plot|axis|legend|infographic|map|survey|share price)\b", re.I)
NUMERIC_TOKEN_RE = re.compile(r"^[\d.,:%$£€¥+\-]+$")


@dataclass(frozen=True, slots=True)
class MediaClassification:
    kind: str
    kind_source: str
    chart_score: float
    ocr_word_count: int
    ocr_avg_confidence: float
    ocr_text_excerpt: str


def classify_media(
    *,
    fallback_kind: str,
    screenshot_bytes: bytes | None,
    title: str,
    alt: str,
    caption: str,
    credit: str,
) -> MediaClassification:
    hint_text = clean_text(" ".join(part for part in (title, alt, caption, credit) if part))
    hint_match = bool(CHART_HINT_RE.search(hint_text))

    if not screenshot_bytes:
        kind = "chart" if hint_match else fallback_kind
        return MediaClassification(
            kind=kind,
            kind_source="metadata" if hint_match else "dom",
            chart_score=2.5 if hint_match else 0.0,
            ocr_word_count=0,
            ocr_avg_confidence=0.0,
            ocr_text_excerpt="",
        )

    ocr = _run_ocr(screenshot_bytes)
    ocr_hint_match = bool(CHART_HINT_RE.search(ocr["text"]))
    structural_chart_signal = hint_match or ocr_hint_match or ocr["numeric_ratio"] >= 0.12
    score = 0.0
    if hint_match:
        score += 2.5
    if ocr["word_count"] >= 8 and structural_chart_signal:
        score += 1.25
    if ocr["numeric_ratio"] >= 0.25 and ocr["word_count"] >= 6:
        score += 1.5
    if ocr["short_word_ratio"] >= 0.55 and ocr["word_count"] >= 6:
        score += 1.0
    if ocr["line_count"] >= 3 and ocr["avg_words_per_line"] <= 6:
        score += 1.0
    if ocr["text_coverage"] >= 0.08 and structural_chart_signal:
        score += 1.0
    if ocr_hint_match:
        score += 1.25
    if ocr["word_count"] <= 3 and not hint_match:
        score -= 1.0
    if ocr["avg_words_per_line"] >= 10 and ocr["line_count"] <= 2:
        score -= 0.75
    if not structural_chart_signal and ocr["word_count"] >= 12:
        score -= 2.0

    kind = fallback_kind
    kind_source = "dom"
    if score >= 3.0:
        kind = "chart"
        kind_source = "ocr"
    elif hint_match:
        kind = "chart"
        kind_source = "metadata"

    return MediaClassification(
        kind=kind,
        kind_source=kind_source,
        chart_score=round(score, 3),
        ocr_word_count=ocr["word_count"],
        ocr_avg_confidence=round(ocr["avg_confidence"], 3),
        ocr_text_excerpt=ocr["text"][:240],
    )


def _run_ocr(screenshot_bytes: bytes) -> dict[str, float | int | str]:
    image = Image.open(io.BytesIO(screenshot_bytes))
    if image.mode not in {"RGB", "L"}:
        image = image.convert("RGB")

    processed = ImageOps.grayscale(image)
    processed = ImageOps.autocontrast(processed)
    processed = ImageEnhance.Sharpness(processed).enhance(1.6)
    if processed.width < 1200:
        scale = max(1, int(1200 / max(processed.width, 1)))
        processed = processed.resize((processed.width * scale, processed.height * scale))

    data = pytesseract.image_to_data(
        processed,
        config="--psm 11",
        output_type=pytesseract.Output.DICT,
    )

    words: list[str] = []
    confidences: list[float] = []
    numeric_tokens = 0
    short_tokens = 0
    line_keys: set[tuple[int, int, int]] = set()
    text_area = 0.0
    for i, raw_text in enumerate(data.get("text", [])):
        text = clean_text(str(raw_text))
        if not text:
            continue
        try:
            confidence = float(data["conf"][i])
        except (KeyError, ValueError, TypeError):
            confidence = -1.0
        if confidence < 35:
            continue
        words.append(text)
        confidences.append(confidence)
        if NUMERIC_TOKEN_RE.match(text):
            numeric_tokens += 1
        if len(re.sub(r"\W+", "", text)) <= 4:
            short_tokens += 1
        try:
            line_keys.add(
                (
                    int(data["block_num"][i]),
                    int(data["par_num"][i]),
                    int(data["line_num"][i]),
                )
            )
            text_area += max(0, int(data["width"][i])) * max(0, int(data["height"][i]))
        except (KeyError, ValueError, TypeError):
            pass

    word_count = len(words)
    line_count = len(line_keys) if words else 0
    avg_words_per_line = (word_count / line_count) if line_count else 0.0
    image_area = float(processed.width * processed.height) if processed.width and processed.height else 1.0
    text_coverage = min(1.0, text_area / image_area)
    avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0
    text = clean_text(" ".join(words))

    return {
        "text": text,
        "word_count": word_count,
        "avg_confidence": avg_confidence,
        "numeric_ratio": (numeric_tokens / word_count) if word_count else 0.0,
        "short_word_ratio": (short_tokens / word_count) if word_count else 0.0,
        "line_count": line_count,
        "avg_words_per_line": avg_words_per_line,
        "text_coverage": text_coverage,
    }
