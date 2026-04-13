from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional, Protocol

from google import genai as google_genai
from google.genai import types as google_genai_types
from loguru import logger
from openai import OpenAI

from .schemas import PipelineConfig


class ArticleBackend(Protocol):
    name: str

    def refine_article(self, title: str, url: str, raw_article: str) -> dict[str, str]:
        ...

    def summarize_article(
        self,
        refined_title: str,
        paragraphs_en: list[str],
        validation_feedback: str | None = None,
    ) -> dict[str, list[str]]:
        ...

    def extract_discussion_topics(self, refined_title: str, summary_en: list[str]) -> dict[str, list[str]]:
        ...

    def extract_c1_vocab(self, refined_title: str, paragraphs_en: list[str]) -> dict[str, list[dict[str, str]]]:
        ...

    def extract_atypical_terms(
        self, refined_title: str, paragraphs_en: list[str]
    ) -> dict[str, list[dict[str, str]]]:
        ...

    def build_image_prompt(self, refined_title: str, summary_en: list[str]) -> dict[str, str]:
        ...

    def generate_image(self, image_prompt: str, output_path: Path) -> dict[str, Optional[str]]:
        ...


class OpenAIArticleBackend:
    name = "openai"

    def __init__(
        self,
        client: OpenAI,
        model: str,
        image_model: str,
        image_size: str,
        gemini_client: google_genai.Client | None = None,
    ) -> None:
        self.client = client
        self.model = model
        self.image_model = image_model
        self.image_size = image_size
        self.gemini_client = gemini_client

    def _json_response(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        response = self.client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            text={"format": {"type": "json_object"}},
        )
        return json.loads(response.output_text)

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

    def generate_image(self, image_prompt: str, output_path: Path) -> dict[str, Optional[str]]:
        if self.gemini_client is not None:
            return self._generate_image_gemini(image_prompt, output_path)
        return self._generate_image_openai(image_prompt, output_path)

    def _generate_image_gemini(self, image_prompt: str, output_path: Path) -> dict[str, Optional[str]]:
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

    def _generate_image_openai(self, image_prompt: str, output_path: Path) -> dict[str, Optional[str]]:
        import base64
        result = self.client.images.generate(
            model=self.image_model,
            prompt=image_prompt,
            size=self.image_size,
        )
        image_url = None
        image_path = None
        if hasattr(result, "data") and result.data:
            first = result.data[0]
            image_url = getattr(first, "url", None)
            b64_json = getattr(first, "b64_json", None)
            if b64_json:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                output_path.write_bytes(base64.b64decode(b64_json))
                image_path = str(output_path)
        return {"image_url": image_url, "image_path": image_path}


def _build_gemini_client(image_model: str) -> google_genai.Client | None:
    if not image_model.startswith("gemini-"):
        return None
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is required for Gemini image models. Set it in .env.local.")
    logger.info("Using Gemini for image generation (model={}).", image_model)
    return google_genai.Client(api_key=gemini_api_key)


def build_backend(config: PipelineConfig) -> ArticleBackend:
    gemini_client = _build_gemini_client(config.image_model)

    if config.backend == "gemma4":
        from .gemma4_backend import build_gemma4_backend
        return build_gemma4_backend(
            model_id=config.model,
            image_model=config.image_model,
            gemini_client=gemini_client,
        )

    # openai backend
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required. Set it in the shell or in .env.local.")
    logger.info("Using the OpenAI backend (model={}).", config.model)
    return OpenAIArticleBackend(
        client=OpenAI(api_key=api_key, max_retries=0),
        model=config.model,
        image_model=config.image_model,
        image_size=config.image_size,
        gemini_client=gemini_client,
    )
