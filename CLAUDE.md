# Freight Market Summary Tool

## What This Is
A Node.js CLI tool that generates weekly freight and trucking industry reports. It collects data from 6 sources (YouTube, podcasts, stock news, earnings transcripts, X/Twitter posts, and chart images), synthesizes everything with Claude AI, and delivers professional HTML/PDF reports via email. Single-user, no database, no web server.

## Tech Stack
- **Language:** Node.js 18+ (plain JavaScript, no TypeScript, no build step)
- **APIs:**
  - Anthropic Claude — report synthesis + image classification (chart detection)
  - Yahoo Finance RSS — stock news (free, unofficial)
  - Financial Modeling Prep (optional) — earnings call transcripts
  - OpenAI Whisper (optional) — podcast audio transcription
  - Apify (optional) — X/Twitter list scraping
  - Gmail SMTP (via nodemailer) — email delivery; SendGrid as fallback
- **Key Libraries:** @anthropic-ai/sdk, nodemailer, @sendgrid/mail, puppeteer-core, xml2js, youtube-transcript
- **No database** — stateless, all data in memory, reports saved as flat files

## Architecture

```
freight_summary.js      # Main orchestrator (788 lines, 10-step pipeline)
youtube_scraper.js      # YouTube channel scraping + transcript extraction
podcast_scraper.js      # RSS feed parsing + 4-tier fallback transcription
stock_news.js           # Yahoo Finance RSS news fetching
earnings_transcripts.js # FMP API earnings call transcripts
x_scraper.js            # Apify Twitter list scraping + image classification
config.json             # All non-secret settings
.env                    # API keys (gitignored)
```

## Pipeline Flow (10 Steps)
```
[1] Load config + env vars
[2] Scrape YouTube videos + transcripts
[3] Scrape podcast episodes (RSS → transcript/notes)
[4] Fetch stock news (Yahoo Finance RSS)
[5] Fetch earnings transcripts (FMP)
[6] Scrape X/Twitter list posts
[7] Download + classify tweet images (Claude vision → chart vs. other)
[8] Build prompt + call Claude API for report synthesis
[9] Save markdown + generate styled HTML + PDF
[10] Email report (HTML body + PDF attachment)
```

## What's Configured
- **YouTube:** FreightWaves, DAT Freight & Analytics
- **Podcasts:** 4 RSS feeds (FreightWaves What The Truck + 3 others)
- **Stock Tickers:** ODFL, KNX, WERN, SAIA, XPO, CHRW, JBHT, FDX, UPS
- **X/Twitter:** List URL with freight industry accounts (500+ posts/week)
- **Email:** Gmail to bunker.ryan@gmail.com, matt@shieldsbrowncpa.com
- **Claude Model:** claude-opus-4-6

## Configuration

### Secrets (.env)
All API keys go in `.env`, never in `config.json`:
- `ANTHROPIC_API_KEY` — Required. Powers Claude AI report generation.
- `OPENAI_API_KEY` — Optional. Enables Whisper transcription for podcasts.
- `SENDGRID_API_KEY` — Optional. Alternative email provider.
- `APIFY_API_KEY` — Optional. Enables X/Twitter scraping.
- `GMAIL_APP_PASSWORD` — Required for Gmail email delivery.
- `FMP_API_KEY` — Optional. Enables earnings transcript fetching.

### Non-secret settings (config.json)
- `youtube_channels` — Array of `{ name, channel_handle }` objects
- `podcast_feeds` — Array of `{ name, rss_url }` objects
- `stock_tickers` — Array of ticker symbols
- `x_list_url` — URL of an X/Twitter list to scrape
- `claude_model` — Claude model ID
- `email.provider` — `"gmail"` or `"sendgrid"`
- `email.gmail_address` — Gmail sender address
- `email.to_emails` — Array of recipient email addresses
- `email.subject_prefix` — Email subject line prefix

## Key Architecture Decisions
- **No `.env` library** — Manually parses `.env` at startup instead of using dotenv. Env vars override config.json placeholders.
- **puppeteer-core** — PDF generation requires system Chrome/Chromium. Gracefully skips if not found.
- **Dual email support** — Gmail (Nodemailer) primary; SendGrid fallback.
- **Content budgeting** — Caps prompt at ~400K chars to stay within Claude's context window.
- **Graceful degradation** — Optional features (Whisper, Apify, FMP, SendGrid) skip cleanly when API keys missing.

## Important Rules
- **Never commit `.env`** — It is gitignored. All credentials belong there, not in `config.json`.
- **Never put secrets in `config.json`** — The `api_keys` section uses placeholders; real keys come from `.env`.
- **Output files are gitignored** — Generated reports (`freight_summary_*.md`, `.html`, `.pdf`) are not committed.
- **Keep it simple** — Single-user CLI tool, not a web service. Avoid over-engineering.
- **Preserve the 10-step console output flow** — The main function logs numbered steps. Keep this structure when adding features.

## Common Tasks
- **Adding a YouTube channel:** Add `{ "name": "...", "channel_handle": "@..." }` to `youtube_channels` in `config.json`.
- **Adding a podcast:** Add `{ "name": "...", "rss_url": "..." }` to `podcast_feeds` in `config.json`.
- **Adding a stock ticker:** Append to `stock_tickers` in `config.json`.
- **Adding an email recipient:** Append to `email.to_emails` in `config.json`.
- **Changing the AI model:** Update `claude_model` in `config.json`.

## How to Run
```bash
node freight_summary.js
```
No build step required. Outputs: `freight_summary_YYYY-MM-DD.md`, `.html`, `.pdf`

## Current State (as of 2026-03-25)
**Status: Production-ready, actively used weekly.**

- Full pipeline working end-to-end
- Last successful run: 2026-03-23
- All 6 data collection modules functional
- Report generation, HTML styling, PDF, and email delivery all working
- ~$0.02–0.10 per weekly run (Claude API cost)
- No known bugs

### Recent Changes
- Fixed X scraper to fetch all posts (was limited to 10)
- Updated podcast feeds and YouTube channels
- Added FDX/UPS tickers and earnings call transcript module
- Switched from individual X handles to list URL scraping
- Switched email from SendGrid to Gmail SMTP as primary

### Known Limitations
- PDF generation skipped if Chrome not installed (warning only, not an error)
- No automated scheduling — run manually or via external scheduler (cron/Task Scheduler)
- X/Twitter scraping depends on Apify third-party actor (could break if Twitter changes)
- Yahoo Finance RSS is unofficial and could be discontinued
