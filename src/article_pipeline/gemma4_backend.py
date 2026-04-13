from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional

from google import genai as google_genai
from google.genai import types as google_genai_types
from loguru import logger

from local_gemma4 import Gemma4Service, ModelConfig

from ._mlx_lock import MLX_LOCK


def _extract_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from raw model output.

    Attempts in order:
    1. Direct json.loads (clean output)
    2. Strip markdown code fence, then json.loads
    3. json_repair on the full text (handles unescaped quotes, trailing commas, etc.)
    4. Grab the outermost {...} and json_repair it
    """
    from json_repair import repair_json

    stripped = text.strip()

    # Fast path: well-formed JSON
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    # Strip markdown fence
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    candidate = m.group(1) if m else stripped

    # json_repair handles the common LLM failure modes:
    # unescaped inner quotes, trailing commas, single-quoted strings, truncation
    try:
        result = json.loads(repair_json(candidate))
        if isinstance(result, dict):
            return result
    except Exception:
        pass

    # Last resort: find outermost {...} and repair that
    m = re.search(r"\{.*\}", stripped, re.DOTALL)
    if m:
        try:
            result = json.loads(repair_json(m.group(0)))
            if isinstance(result, dict):
                return result
        except Exception:
            pass

    raise ValueError(f"Could not parse JSON from model output: {stripped[:400]!r}")


class Gemma4ArticleBackend:
    name = "gemma4"

    def __init__(
        self,
        service: Gemma4Service,
        image_model: str,
        gemini_client: google_genai.Client | None = None,
    ) -> None:
        self._service = service
        self.image_model = image_model
        self.gemini_client = gemini_client

    def _json_response(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        combined = (
            system_prompt.strip()
            + "\n\nRespond with ONLY the JSON object. No explanation, no markdown fences, no extra text.\n\n"
            + user_prompt.strip()
        )
        with MLX_LOCK:
            result = self._service.generate([{"role": "user", "content": combined}])
        return _extract_json(result.text)

    # ------------------------------------------------------------------ #
    #  Text pipeline                                                       #
    # ------------------------------------------------------------------ #

    def refine_article(self, title: str, url: str, raw_article: str) -> dict[str, str]:
        system = """
You are an expert editor for English-learning news content.
Refine the article while preserving meaning and factual content.

Requirements:
- Clean grammar, awkward phrasing, and redundancy.
- Keep the tone natural and readable.
- Do not invent facts.
- Keep the article suitable for upper-intermediate to advanced learners.
- Return JSON with:
  {
    "refined_title": "...",
    "refined_article": "..."
  }
"""
        user = f"""Title:
{title}

URL:
{url}

Article:
{raw_article}
"""
        return self._json_response(system, user)

    def summarize_article(
        self,
        refined_title: str,
        paragraphs_en: list[str],
        validation_feedback: str | None = None,
    ) -> dict[str, list[str]]:
        system = """
You are creating a concise learner-friendly summary.

Requirements:
- Write exactly 3 bullet points.
- Each bullet must capture a meaningful point from the article.
- Keep the bullets informative but concise.
- Return JSON:
  {
    "summary_en": ["bullet 1", "bullet 2", "bullet 3"]
  }
"""
        if validation_feedback:
            system += f"""
Additional validation feedback from the previous attempt:
- {validation_feedback}
- Correct the output and follow the schema exactly.
"""
        user = f"""Title:
{refined_title}

Paragraphs:
{json.dumps(paragraphs_en, ensure_ascii=False)}
"""
        return self._json_response(system, user)

    def extract_c1_vocab(self, refined_title: str, paragraphs_en: list[str]) -> dict[str, list[dict[str, str]]]:
        system = """
You are selecting advanced English expressions for Korean learners.

Requirements:
- Extract vocabulary and expressions that are CEFR C1 or C2 or above.
- Include only items that are genuinely useful or notable.
- Avoid trivial words.
- Return 5 to 12 items.
- The "term" must be normalized to its dictionary or base form, not the inflected surface form from the article.
- Prefer the canonical original expression without tense or aspect inflection.
- For verbs and verbal phrases, remove past tense and -ing forms when possible.
- Keep multi-word expressions and phrasal verbs together.
- If the article uses an inflected form like "levelling-off", normalize it to "level-off".
- Return JSON:
  {
    "c1_vocab": [
      {
        "term": "...",
        "meaning_en": "...",
        "reason": "Why this is advanced or notable",
        "example_from_article": "..."
      }
    ]
  }
"""
        user = f"""Title:
{refined_title}

Paragraphs:
{json.dumps(paragraphs_en, ensure_ascii=False)}
"""
        return self._json_response(system, user)

    def extract_discussion_topics(self, refined_title: str, summary_en: list[str]) -> dict[str, list[str]]:
        system = """
You are writing discussion prompts for advanced Korean learners based on a news article.

Ground-truth style:
- Write mostly question-form prompts.
- Make every prompt open-ended and debate-ready, not factual quiz questions.
- Favor these frames across the set: agree/disagree stance, stakeholder impact, counterargument, Korea-localized implications, long-term consequences, policy or practical recommendation, and personal or observed parallel case.

Requirements:
- Return exactly 8 discussion prompts.
- Write every prompt in natural English.
- Every prompt must end with a question mark.
- Include at least one Korea-localized prompt.
- Korea-localized means applying the article's situation or perspective to Korea, South Korea, Korean society, Korean companies, Korean workers, Korean policy, or the Korean market.
- Do not switch the prompt language to Korean.
- Include at least one prompt that explicitly asks for the strongest counterargument, opposing view, criticism, or downside.
- Include at least one action or policy prompt.
- Keep each prompt specific to the article, concise, and natural.
- Return JSON:
  {
    "discussion_topics": [
      "...?",
      "...?"
    ]
  }
"""
        user = f"""Title:
{refined_title}

Summary:
{json.dumps(summary_en, ensure_ascii=False)}
"""
        return self._json_response(system, user)

    def extract_atypical_terms(
        self, refined_title: str, paragraphs_en: list[str]
    ) -> dict[str, list[dict[str, str]]]:
        system = """
You are extracting atypical terms from an English article.

Include:
- acronyms
- abbreviations
- proper nouns
- organization names
- policy names
- product names
- place names
- unusual technical terms

Return JSON:
{
  "atypical_terms": [
    {
      "term": "...",
      "category": "acronym|proper_noun|organization|place|technical_term|other",
      "explanation_en": "..."
    }
  ]
}
"""
        user = f"""Title:
{refined_title}

Paragraphs:
{json.dumps(paragraphs_en, ensure_ascii=False)}
"""
        return self._json_response(system, user)

    def build_image_prompt(self, refined_title: str, summary_en: list[str]) -> dict[str, str]:
        system = """
You are writing a photorealistic editorial news image prompt.

Requirements:
- Base the image on the article title and the 3 bullet summary.
- Create a realistic documentary-style news photo prompt.
- The image must look photographic, not illustrated, not 3D rendered, and not stylized.
- Use natural lighting, realistic materials, candid composition, and believable human/environment details.
- Avoid text in the image.
- Avoid logos and copyrighted character references.
- Output one strong prompt string.
- Return JSON:
  {
    "image_prompt": "..."
  }
"""
        user = f"""Title:
{refined_title}

Summary:
{json.dumps(summary_en, ensure_ascii=False)}
"""
        return self._json_response(system, user)

    # ------------------------------------------------------------------ #
    #  Image generation — delegated to Gemini                             #
    # ------------------------------------------------------------------ #

    def generate_image(self, image_prompt: str, output_path: Path) -> dict[str, Optional[str]]:
        if self.gemini_client is None:
            raise RuntimeError(
                "No Gemini client configured for image generation. "
                "Set GEMINI_API_KEY in .env.local."
            )
        response = self.gemini_client.models.generate_content(
            model=self.image_model,
            contents=image_prompt,
            config=google_genai_types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )
        image_path = None
        for part in response.candidates[0].content.parts:
            if part.inline_data:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(part.inline_data.data)
                image_path = str(output_path)
                break
        return {"image_url": None, "image_path": image_path}


class Gemma4KoreanPostEditor:
    def __init__(self, service: Gemma4Service) -> None:
        self._service = service

    def _json_response(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        combined = (
            system_prompt.strip()
            + "\n\nRespond with ONLY the JSON object. No explanation, no markdown fences, no extra text.\n\n"
            + user_prompt.strip()
        )
        with MLX_LOCK:
            result = self._service.generate([{"role": "user", "content": combined}])
        return _extract_json(result.text)

    def polish_translation(
        self,
        *,
        title_en: str,
        subtitle_en: str,
        paragraphs_en: list[str],
        summary_en: list[str],
        title_ko: str,
        subtitle_ko: str,
        paragraphs_ko: list[str],
        summary_ko: list[str],
    ) -> dict[str, Any]:
        system = """
You are editing Korean news-learning content for style consistency and term consistency.

Goals:
- Rewrite the Korean title into a natural Korean news headline style.
- Korean news headlines should not end in polite or fully conjugated sentence endings such as "~합니다", "~입니다", "~하고 있습니다", "~되고 있습니다".
- Prefer concise headline endings such as noun phrases or plain dictionary-style endings like "~확대", "~급증", "~부상", "~좁히다", "~늘리다", "~되다" when natural.
- Apply headline style to `title_ko` only.
- Keep `subtitle_ko`, `paragraphs_ko`, and `summary_ko` in normal natural Korean prose.
- Do not convert paragraphs or summary bullets into headline fragments, noun-only phrases, or overly compressed note style.
- Paragraphs should read like article/body prose.
- Summary bullets should read like concise explanatory sentences for learners, not headlines.
- Keep the meaning faithful to the English source.
- Normalize named entities, product names, and key terms so the same item is written consistently across the title, subtitle, paragraphs, and summary.
- Keep people names, company names, organization names, and product names in English when that is natural and readable in Korean news text.
- Prefer forms like "Anthropic", "OpenAI", "Claude Code", "Ramp", "ChatGPT" instead of transliterating them into Korean when possible.
- Preserve product names as exact English strings when possible.
- Do not create mixed Korean-English hybrids such as "클로드 Code" or "ChatGPT 도구명".
- If the source uses "Claude Code", keep it exactly as "Claude Code".
- If a named entity must be rendered in Korean, choose one form and use it consistently everywhere.
- Keep paragraph count and summary bullet count exactly unchanged.
- Keep the Korean text natural and fluent. Do not add new facts.

Return JSON:
{
  "title_ko": "...",
  "subtitle_ko": "...",
  "paragraphs_ko": ["...", "..."],
  "summary_ko": ["...", "..."]
}
"""
        user = f"""English title:
{title_en}

English subtitle:
{subtitle_en}

English paragraphs:
{json.dumps(paragraphs_en, ensure_ascii=False)}

English summary:
{json.dumps(summary_en, ensure_ascii=False)}

Current Korean title:
{title_ko}

Current Korean subtitle:
{subtitle_ko}

Current Korean paragraphs:
{json.dumps(paragraphs_ko, ensure_ascii=False)}

Current Korean summary:
{json.dumps(summary_ko, ensure_ascii=False)}
"""
        return self._json_response(system, user)


def build_gemma4_backend(
    model_id: str,
    image_model: str,
    gemini_client: google_genai.Client | None,
) -> Gemma4ArticleBackend:
    config = ModelConfig(model_id=model_id)
    service = Gemma4Service(config)
    logger.info("Using the Gemma 4 backend (model={}).", model_id)
    return Gemma4ArticleBackend(service=service, image_model=image_model, gemini_client=gemini_client)


def build_gemma4_korean_post_editor(model_id: str) -> Gemma4KoreanPostEditor:
    config = ModelConfig(model_id=model_id)
    service = Gemma4Service(config)
    logger.info("Using Gemma 4 Korean post-editor (model={}).", model_id)
    return Gemma4KoreanPostEditor(service=service)
