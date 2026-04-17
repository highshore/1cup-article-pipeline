# Article Pipeline

Reads English news articles from `input/`, enriches them through a multi-stage LangGraph pipeline, and writes structured JSON output to `output/`.

The repo also includes a browser-based crawler for Financial Times and The Wall Street Journal in `src/crawler/`. It opens Playwright Chromium with the bundled `extensions/bypass-chrome` extension, collects top stories from key sections, skips URLs already saved in a local SQLite store, and writes one JSON file per article into `input/crawled/`.
The crawler now also saves cropped media assets under `input/crawled/_media/` and inlines their metadata directly inside each article JSON.
For manual review, a separate Next.js workspace lives in `apps/dashboard`, reading the same SQLite database and storing approve/defer/reject decisions in a dedicated review table.

**What it produces per article:**
- Refined English text, re-split into paragraphs
- 3-bullet summary
- CEFR C1 vocabulary extraction
- Atypical term extraction (acronyms, proper nouns, etc.)
- Korean translation (local, on-device)
- A photorealistic image generated from the article summary

---

## Requirements

- **Python 3.13**
- **[uv](https://docs.astral.sh/uv/)** for dependency management
- **Apple Silicon Mac** — both the text backend and the translation backend run via MLX
- **32 GB unified memory minimum** for the default Gemma 4 text model (48 GB recommended)
- **Hugging Face account** with gated model access accepted

---

## Keys Needed

Create `.env.local` in the repository root:

```env
GEMINI_API_KEY=your_gemini_key      # always required — used for image generation
OPENAI_API_KEY=your_openai_key      # only required if running --backend openai
```

The pipeline loads that file automatically at startup. The Next.js dashboard in `apps/dashboard` uses the same
root env file through an app-local `.env.local` symlink that its npm scripts create on demand.

---

## First-Time Setup

```bash
# 1. Install dependencies
uv sync

# 2. Authenticate with Hugging Face (required for gated models)
hf auth login
```

Then accept the license terms on Hugging Face for both models:

- [`google/gemma-4-E4B-it`](https://huggingface.co/google/gemma-4-E4B-it) — default text pipeline model (smaller than 26B A4B, downloads on first run)
- [`mlx-community/translategemma-12b-it-4bit`](https://huggingface.co/mlx-community/translategemma-12b-it-4bit) — Korean translation (~6 GB, downloads on first run)

---

## Input Format

Place one or more `.txt` files in `input/`. Each file must follow this format:

```text
Title: Why Cities Are Rethinking the Future of Public Transit
URL: https://example.com/public-transit-future
Article Text:
Many cities are reconsidering how public transportation should evolve...
```

The filename (without extension) becomes the article ID used for output files.

---

## Running

### Crawl FT / WSJ inputs first

```bash
uv run article-crawler --source all --limit-per-section 5
```

### Review crawled articles in the dashboard

```bash
cd apps/dashboard
npm install
npm run dev
```

Then open `http://localhost:3000`.

Useful options:

- `--source ft` or `--source wsj`
- `--url https://...` to extract one specific article directly
- `--migrate-legacy-output` to convert older `.txt` + `.media.json` crawler output into the single-JSON format
- `--section frontpage --section tech`
- `--headless` if your local Chromium build supports extensions in headless mode
- `--chrome-executable-path /path/to/chromium-binary` only if you want to override Playwright's default Chromium binary
- `--profile-dir artifacts/crawler/profiles` to control where temporary per-run Chromium profiles are created

Important: Playwright can no longer side-load extensions into branded Google Chrome, so the crawler intentionally uses Chromium and will fail fast if the extension service worker does not load.
The launcher also strips Playwright's default `--disable-extensions` flag, otherwise Chromium will start without the unpacked bypass extension.
The crawler uses a fresh temporary Chromium profile for each run to avoid crashes from stale persistent profile state.

The crawler stores dedupe state in `data/crawler.sqlite3` and emits new article JSON files under `input/crawled/`.
Each article JSON includes `crawl_timestamp`, `title`, `subtitle`, `url`, and an ordered `article` array that mixes paragraph blocks with full media blocks in document order.
Media blocks include OCR-assisted chart classification fields such as `kind_source`, `chart_score`, `ocr_word_count`, `ocr_avg_confidence`, and `ocr_text_excerpt`.
When figures or inline images are found, the cropped media assets are stored in `input/crawled/_media/<article-id>/`.

### Default run (Gemma 4 text + Gemini images)

```bash
uv run article-pipeline
```

On first run, both MLX models will download to the Hugging Face cache. Subsequent runs start immediately.

### Run with the OpenAI text backend instead

```bash
uv run article-pipeline --backend openai --model gpt-4.1
```

### Skip image generation

```bash
uv run article-pipeline --skip-image
```

### Use a cached model without network access

```bash
uv run article-pipeline --translator-offline
```

### Process a single file

```bash
uv run article-pipeline --input-path input/article.txt
```

### Disable the progress bar

```bash
uv run article-pipeline --disable-progress
```

---

## All CLI Options

| Flag | Default | Description |
|---|---|---|
| `--backend` | `gemma4` | Text backend: `gemma4` (local MLX) or `openai` |
| `--model` | `google/gemma-4-E4B-it` | Text model (HF repo ID or local path) |
| `--image-model` | `gemini-3.1-flash-image-preview` | Image generation model |
| `--image-size` | `1536x1024` | Image size (OpenAI backend only) |
| `--input-path` | `input/` | Input `.txt` file or directory |
| `--output-dir` | `output/` | Output directory for JSON and images |
| `--max-workers` | `4` | Parallel workers for independent stages |
| `--max-retries` | `3` | Retry limit per pipeline stage |
| `--log-level` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`) |
| `--disable-progress` | off | Disable the tqdm progress bar |
| `--skip-image` | off | Skip image generation entirely |
| `--translator-model` | `mlx-community/translategemma-12b-it-4bit` | Translation model |
| `--translator-source` | `en` | Source language code |
| `--translator-target` | `ko` | Target language code |
| `--translator-offline` | off | Use cached model only, no network |
| `--skip-translator-warmup` | off | Skip MLX warmup at startup |
| `--translator-max-tokens` | `3072` | Max tokens per translation generation |
| `--translator-chunk-input-tokens` | `1536` | Input token budget per chunk |
| `--translator-context-window-tokens` | `2048` | Tokenizer context window |

---

## Output

For each input file, the pipeline writes:

**`output/<article-id>.json`** — full enriched article:
```json
{
  "refined_title": "...",
  "refined_article": "...",
  "paragraphs_en": ["...", "..."],
  "summary_en": ["...", "...", "..."],
  "c1_vocab": [{ "term": "...", "meaning_en": "...", "reason": "...", "example_from_article": "..." }],
  "atypical_terms": [{ "term": "...", "category": "...", "explanation_en": "..." }],
  "title_ko": "...",
  "paragraphs_ko": ["...", "..."],
  "summary_ko": ["...", "...", "..."],
  "image_prompt": "...",
  "image_path": "output/images/<article-id>.png",
  "errors": [],
  "execution": { ... }
}
```

**`output/images/<article-id>.png`** — generated image (unless `--skip-image`)

**`output/run_summary.json`** — aggregate results across all articles in the run

**`logs/article_pipeline_<timestamp>.log`** — full structured log

---

## Architecture

```
src/
├── article_pipeline/       # Pipeline orchestration and CLI
│   ├── cli.py              # Entry point, argument parsing
│   ├── pipeline.py         # LangGraph graph definition and stage nodes
│   ├── openai_backend.py   # OpenAI text backend + backend factory
│   ├── gemma4_backend.py   # Gemma 4 text backend adapter
│   ├── translator.py       # TranslateGemma adapter
│   ├── schemas.py          # Pydantic + TypedDict models
│   ├── io.py               # File I/O and env loading
│   └── logging_utils.py    # loguru + tqdm integration
│
├── local_gemma4/           # Self-contained Gemma 4 MLX inference service
│   ├── service.py          # Model load, generate, retry
│   ├── schemas.py          # ModelConfig, InferenceResult
│   ├── model_locator.py    # Resolves local path / HF cache / hub
│   ├── retry.py            # Exponential backoff retry
│   └── errors.py           # Custom exceptions
│
└── local_translategemma/   # Self-contained TranslateGemma MLX service
    ├── service.py          # Model load, translate, chunking, retry
    ├── runner.py           # Batch translation orchestrator
    ├── schemas.py          # ModelConfig, TranslationResult, etc.
    ├── model_locator.py    # Resolves local path / HF cache / hub
    ├── retry.py            # Exponential backoff retry
    ├── errors.py           # Custom exceptions
    └── cli.py              # Standalone translation CLI (separate from pipeline)
```

### Pipeline flow

```
input/*.txt
    │
    ▼
Parse + validate input
    │
    ▼
LangGraph critical path ──────────────────────────────────────────┐
    │                                                             │
    ├─ refine_article                                             │
    ├─ resplit_paragraphs ──► validate ──► retry if invalid       │
    └─ summarize ───────────► validate ──► retry if invalid       │
                                                                  │
    ◄─────────────────────────────────────────────────────────────┘
    │
    ▼ parallel fan-out
    ├─ extract C1 vocab          (text backend)
    ├─ extract atypical terms    (text backend)
    ├─ translate to Korean       (local TranslateGemma / MLX)
    └─ build image prompt ──► generate image  (Gemini)
    │
    ▼
Merge + write output/<article-id>.json
```

### Backends

| Stage | Default | Alternative |
|---|---|---|
| Text enrichment | Gemma 4 26B MoE (local MLX via `mlx-vlm`) | OpenAI (`--backend openai`) |
| Image generation | Gemini `gemini-3.1-flash-image-preview` | — |
| Korean translation | TranslateGemma 12B (local MLX via `mlx-lm`) | different model via `--translator-model` |

---

## Failure Behavior

The pipeline does not crash on stage failures. Instead it:

- retries transient errors (network timeouts, rate limits) with exponential backoff
- retries invalid model outputs through LangGraph validation edges with correction feedback
- records failures in the article output under `errors[]`
- skips downstream stages when a critical upstream stage fails
- exits with code `1` if any article had errors, `0` if all succeeded
