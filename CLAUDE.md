# trader-intelligence (TI)

AI trade journaling + LLM pattern analysis. Pillar 2 of the AI Automation Business. Tradovate → classify → daily summary + weekly perf report. Dogfood-first: Noah uses on own trades, then sells to Gumroad indicator customers.

## Architecture

```
src/
  classify/       — LLM trade classification (Claude API + OpenRouter batch)
  metrics/        — r-multiple + performance math
  input/          — CSV + Tradovate trade ingestion
  summarize/      — daily summary generator
  tradovate/      — auth, client, fetch-trades
  publish/        — writes runs to MC (ti_runs + trade_classifications)
  persistence/    — Supabase: trades, classifications, runs
  delivery/       — markdown output, Telegram delivery
  workers/        — daily-pull cron worker
  types.ts        — shared type definitions
db/               — migrations
docs/             — specs, plans
tests/            — vitest unit tests
```

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (Node) |
| Test | Vitest |
| DB | Supabase (Postgres) |
| LLM | Claude API (classify) + OpenRouter (batch) |
| Delivery | Telegram bot |
| Hosting | TBD (currently local / cron) |

## Status

**Active dogfood** — in use by Noah on own Tradovate trades. 30-day usage window before product decision. Do NOT pitch or sell yet.

Key constraint: `claude -p` batch jobs must delete `ANTHROPIC_API_KEY` from child env — otherwise hits pay-as-you-go balance instead of subscription.

Brain context: `~/.claude/noah/brain/06-business.md` (AI Automation Business section)
Memory: `~/.claude/memory/project_ai_automation_business.md`

## Repo digest

Architectural overview at `~/dev/claude-brain/brain/projects/trader-intelligence/digest.md`.

## Session scope (TRADER INTELLIGENCE ONLY)

When session starts in this repo:
- **Greet** with active TI task / dogfood status / any classify/persist failures
- **DO NOT auto-load** `brain/tasks/today.md`, `brain/02-trading.md` (quant), `brain/04-career.md`
- **DO NOT mention** Polymarket, Pine Script indicators, job hunt, CBS — unless Noah asks
- Auth: Tradovate credentials in `~/.config/noah/secrets/api-keys.env` (TRADOVATE_* keys)
- Cross-domain queries answerable on demand
