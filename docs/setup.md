# Setup

## 1. Clone and install

```bash
git clone https://github.com/noahduus-create/trader-intelligence.git
cd trader-intelligence
pnpm install
```

## 2. Tradovate

You need:
- Username + password
- App ID + App Version (1.0 is fine)
- CID + Secret (request via Tradovate API portal)
- Account ID (the numeric ID, not the display name)

Add to `.env.local`:

```
TRADOVATE_API_URL=https://live.tradovateapi.com/v1
TRADOVATE_USERNAME=...
TRADOVATE_PASSWORD=...
TRADOVATE_APP_ID=...
TRADOVATE_APP_VERSION=1.0
TRADOVATE_CID=...
TRADOVATE_SEC=...
TRADOVATE_ACCOUNT_ID=...
```

**Note on 2FA:** If your account has device verification enabled, the first auth will fail with a `p-ticket challenge` error. Log in manually via the Tradovate web app once to dismiss the challenge, then re-run.

## 3. Anthropic

Get a key from console.anthropic.com.

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 4. Supabase

You need a Supabase project with the `trader_intel` schema applied.

```bash
# Apply migrations against your Supabase project (set DATABASE_URL first)
psql "$DATABASE_URL" -f db/migrations/0001-trader-intel-schema.sql
psql "$DATABASE_URL" -f db/migrations/0002-trades-table.sql
psql "$DATABASE_URL" -f db/migrations/0003-classifications-table.sql
```

Add to `.env.local`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## 5. Brain folder (where summaries get written)

```
BRAIN_DAILY_PATH=/path/to/your/daily/notes
```

For me, that's an Obsidian vault folder. For you, it can be anywhere markdown files make sense.

## 6. Telegram (optional)

If you want daily summary delivered to a Telegram chat:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Skip these to disable Telegram delivery.

## 7. Run

```bash
pnpm daily              # today
pnpm daily 2026-05-09   # specific date
```

## 8. Schedule (production)

Use `cron`, `launchd`, or Vercel Cron. Example cron at 18:00 daily:

```cron
0 18 * * 1-5 cd /path/to/trader-intelligence && pnpm daily >> ti.log 2>&1
```
