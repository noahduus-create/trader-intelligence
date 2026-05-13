# Trader Intelligence

AI-powered trade journaling and pattern analysis for futures traders.

```bash
pnpm install
cp .env.example .env.local  # fill in Tradovate + Anthropic + Supabase
pnpm daily                  # runs on today's trades
```

## What it does

Every day, this pipeline:

1. Pulls your filled executions from Tradovate
2. Pairs entries with exits to reconstruct trades
3. Computes R-multiple, P&L, and commission per trade
4. Asks Claude to classify each trade: setup, time-of-day, quality, mistakes, notes
5. Generates a Danish-language daily summary in markdown
6. Saves the summary to your brain folder and optionally pings you on Telegram

## Why

Most trade journaling tools are static. You log a trade, the tool stores it. That's it.

This one **reads** your trades. It tells you that you lose most on pre-market shorts that reverse at support. It tells you that your A+ setups happen between 14:30-15:00 UTC. It tells you that "moved stop" appears in 60% of your losing trades.

The LLM does the pattern-finding so you can spend your time trading instead of building spreadsheets.

## Requirements

- Tradovate account (live or demo)
- Anthropic API key
- Supabase project (used for trade + classification storage)
- Node 20+ and pnpm

## Setup

See [`docs/setup.md`](docs/setup.md).

## Architecture

See [`docs/architecture.md`](docs/architecture.md).

## Status

Alpha — built by Noah Duus (prop trader). Used daily on my own account. Public repo as part of Phase D of the 90-day AI Automation Business launch.

## License

MIT. Use it, fork it, modify it. If you commercialize it, a credit would be appreciated but not required.
