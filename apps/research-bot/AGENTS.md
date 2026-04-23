# AGENTS.md — apps/research-bot

Producer runtime for the 1Cup article pipeline.

## Responsibility

- Own the operational SQLite database for queue state, run state, target sources, evaluation criteria, schedules, and artifacts.
- Accept dashboard write intents through a localhost control server.
- Dispatch queued or scheduled WSJ / FT pipeline work.
- Run the article crawl, evaluation, processing, and Kakao delivery workflow.

## Active Flow

1. Dashboard posts write intents to `scripts/article_bot_control_server.py`.
2. The control server mutates `data/article-dashboard.sqlite`.
3. `scripts/article_dispatcher.py` checks due schedules and queued requests.
4. The dispatcher runs `scripts/execute_pipeline_request.py --request-id <id>`.
5. The executor records a `collection_runs` row, updates `pipeline_run_steps`, and calls `scripts/run_article_research_graph.py`.
6. The graph runs WSJ / FT crawl, deterministic evaluation, article processing, and Kakao delivery artifact creation.

## Key Paths

- Queue DB: `data/article-dashboard.sqlite`
- Evaluation criteria config: `config/evaluation-criteria.json`
- Control server: `scripts/article_bot_control_server.py`
- Dispatcher: `scripts/article_dispatcher.py`
- Executor: `scripts/execute_pipeline_request.py`
- Workflow: `scripts/run_article_research_graph.py`
