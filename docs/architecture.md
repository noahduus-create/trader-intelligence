# Architecture

```
[Tradovate API] → [auth + fetch-trades] → [Supabase: trader_intel.trades]
                                                ↓
                                         [classify (Claude)] → [Supabase: trader_intel.classifications]
                                                                       ↓
                                                               [summarize (Claude)]
                                                                       ↓
                                                       [markdown file] + [Telegram]
```

## Modules

| Module | Responsibility |
|--------|-----------------|
| `tradovate/auth` | OAuth token request |
| `tradovate/client` | Authenticated HTTP wrapper |
| `tradovate/fetch-trades` | Pull executions + pair into trades |
| `metrics/r-multiple` | Compute R given entry/exit/stop |
| `persistence/supabase` | Admin-scoped Supabase client factory |
| `persistence/trades` | Upsert trades |
| `persistence/classifications` | Upsert classifications |
| `classify/prompt` | LLM prompt template (cached) |
| `classify/tag-trade` | Single-trade classification call |
| `summarize/daily` | Daily markdown generation |
| `delivery/markdown` | Append to date file |
| `delivery/telegram` | Send via Bot API |
| `workers/daily-pull` | Orchestrator (entry point) |

## Why no real-time?

Real-time alerts add complexity that's not needed for journaling. EOD pull is enough. If demand emerges, real-time is Phase 2.

## Why single-trader?

Multi-account support adds account routing, per-account RLS, and per-account env config. Single-trader is enough to dogfood and prove the model. Multi-trader is Phase 2.

## Why prompt caching?

The classification prompt is ~2KB of static schema definitions and instructions. It runs N times per day (once per trade). Caching saves 90% on input tokens after the first call within the 5-min cache window.
