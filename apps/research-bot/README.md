# Article Research Bot

`apps/research-bot` is the producer side of the WSJ / FT article pipeline. It mirrors the
research-pipeline runtime contract, but adapts the workflow to 1Cup articles, evaluation criteria,
article processing, and Kakao delivery.

## Runtime Model

1. Dashboard writes go through the host-side control server.
2. Queue, schedule, run, step, criteria, target-source, and artifact state live in SQLite.
3. The dispatcher turns due schedules or manual dashboard requests into executable work.
4. The executor runs a LangGraph-style workflow:
   - load criteria and target sources
   - crawl WSJ / FT
   - normalize and evaluate articles
   - run the article processing pipeline
   - create a Kakao-ready delivery artifact
5. The dashboard reads the SQLite state and refreshes while work is active.

## Manual Usage

Start the control server:

```bash
cd /Users/flitto/Desktop/1cup-article-pipeline
./apps/research-bot/scripts/run_control_server.sh
```

Start the dispatcher:

```bash
cd /Users/flitto/Desktop/1cup-article-pipeline
./apps/research-bot/scripts/run_article_dispatcher.sh
```

Enqueue a run:

```bash
cd /Users/flitto/Desktop/1cup-article-pipeline
python3 apps/research-bot/scripts/enqueue_pipeline_run_request.py --trigger-source manual --requested-by flitto
```

Dispatch once:

```bash
cd /Users/flitto/Desktop/1cup-article-pipeline
python3 apps/research-bot/scripts/article_dispatcher.py --once
```

## Environment

- `ARTICLE_BOT_DB_PATH`: override queue DB path.
- `ARTICLE_BOT_CONTROL_PORT`: override control server port. Default: `7721`.
- `ARTICLE_BOT_DRY_RUN=1`: skip the browser crawler and write a dry-run artifact.
- `KAKAO_WEBHOOK_URL`: optional Kakao webhook endpoint. If missing, delivery is recorded as an artifact only.
- `ARTICLE_BOT_PIPELINE_BACKEND`: `gemma4` or `openai`. Default: `gemma4`.
- `ARTICLE_BOT_SKIP_IMAGE=1`: skip image generation during processing.
