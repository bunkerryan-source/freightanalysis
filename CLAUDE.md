# CLAUDE.md - Project Guide for AI Assistants

## Project Overview

**Freight Market Summary Tool** — A Node.js CLI tool that generates weekly freight and trucking industry reports. It scrapes YouTube videos, podcasts, stock news, and X/Twitter posts, sends everything to Claude AI for synthesis, then delivers the report via email (Gmail or SendGrid) as HTML with a PDF attachment.

## How to Run

```bash
node freight_summary.js
```

No build step required. The tool runs as a single orchestrator script.

## Project Structure

```
freight_summary.js    — Main orchestrator (config loading, prompt building, Claude API call, email sending)
youtube_scraper.js    — Fetches recent YouTube videos + transcripts from configured channels
podcast_scraper.js    — Fetches podcast episodes via RSS, optional Whisper transcription via OpenAI
stock_news.js         — Fetches stock news for configured freight/trucking tickers
x_scraper.js          — Scrapes X/Twitter posts via Apify API, downloads and classifies chart images
config.json           — User configuration (channels, feeds, tickers, email settings) — NO secrets here
.env                  — API keys and credentials (gitignored, never committed)
.env.example          — Template showing required environment variables
setup.bat             — Windows desktop shortcut generator
preview_sample.html   — Sample of the styled HTML email output
```

## Configuration

### Secrets (.env)
All API keys and credentials go in `.env`, never in `config.json`:
- `ANTHROPIC_API_KEY` — Required. Powers Claude AI report generation.
- `OPENAI_API_KEY` — Optional. Enables Whisper transcription for podcasts.
- `SENDGRID_API_KEY` — Optional. Alternative email provider.
- `APIFY_API_KEY` — Optional. Enables X/Twitter scraping.
- `GMAIL_APP_PASSWORD` — Required for Gmail email delivery.

### Non-secret settings (config.json)
- `youtube_channels` — Array of `{ name, channel_handle }` objects
- `podcast_feeds` — Array of `{ name, rss_url }` objects
- `stock_tickers` — Array of ticker symbols (e.g., `"ODFL"`, `"KNX"`)
- `x_accounts` — Array of `{ handle }` objects (e.g., `"@freightalley"`)
- `claude_model` — Claude model ID to use (default: `"claude-opus-4-6"`)
- `email.provider` — `"gmail"` or `"sendgrid"`
- `email.gmail_address` — Gmail sender address
- `email.to_emails` — Array of recipient email addresses
- `email.subject_prefix` — Email subject line prefix

## Key Architecture Decisions

- **No `.env` library** — The tool manually parses `.env` at startup (lines 24-36 of `freight_summary.js`) instead of using `dotenv`. Env vars override `config.json` placeholders.
- **puppeteer-core** — Used for PDF generation; requires Chrome/Chromium installed on the system. Gracefully skips if not found.
- **Dual email support** — Gmail (via Nodemailer) is primary; SendGrid is the fallback provider.
- **Content budgeting** — The prompt builder caps total content at ~400K chars to stay within Claude's context window, distributing evenly across sources.

## Important Rules

- **Never commit `.env`** — It is gitignored. All credentials belong there, not in `config.json`.
- **Never put secrets in `config.json`** — The `api_keys` section in config uses placeholder values; real keys come from `.env`.
- **Output files are gitignored** — Generated reports (`freight_summary_*.md`, `.html`, `.pdf`) are not committed.
- **Keep it simple** — This is a single-user CLI tool, not a web service. Avoid over-engineering.
- **Preserve the 9-step console output flow** — The main function logs numbered steps [1/9] through [9/9]. Keep this structure when adding features.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `nodemailer` — Gmail SMTP email
- `@sendgrid/mail` — SendGrid email (alternative)
- `puppeteer-core` — PDF generation (requires system Chrome)
- `xml2js` — RSS feed parsing for podcasts
- `youtube-transcript` — YouTube transcript extraction

## Common Tasks

**Adding a new YouTube channel:** Add `{ "name": "...", "channel_handle": "@..." }` to `youtube_channels` in `config.json`.

**Adding a new podcast:** Add `{ "name": "...", "rss_url": "..." }` to `podcast_feeds` in `config.json`.

**Adding a new email recipient:** Append the email address to `email.to_emails` in `config.json`.

**Changing the AI model:** Update `claude_model` in `config.json`.
