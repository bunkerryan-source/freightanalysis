# Weekly Freight Market Summary Tool

A tool that automatically collects freight/trucking industry data from YouTube, podcasts, stock news, earnings call transcripts, and X/Twitter, then uses Claude AI to generate a structured weekly market summary.

**No Python required.** Uses Node.js, which is typically allowed by IT departments and easy to install.

## What It Does

Every time you run it, the tool:

1. **YouTube** - Pulls the last 7 days of videos from your configured freight/trucking channels and extracts transcripts.
2. **Podcasts** - Pulls the last 7 days of episodes from your RSS feeds. Uses episode descriptions and show notes from the feed. If the feed contains full content, it uses that.
3. **Stock News** - Pulls the last 7 days of news for ODFL, KNX, WERN, SAIA, XPO, CHRW, JBHT, FDX, UPS via Yahoo Finance RSS (free).
4. **Earnings Call Transcripts** - Pulls earnings call transcripts from the last 7 days for all tracked tickers via the Financial Modeling Prep API. Extracts key insights about freight/trucking industry conditions, volumes, pricing, and outlook.
5. **X/Twitter** - Scrapes posts from configured freight industry X/Twitter accounts via Apify.
6. **AI Report** - Sends everything to Claude and generates a report with these sections:
   - (a) Market Conditions Overview
   - (b) Key Events of the Week
   - (c) What the Industry is Talking About
   - (d) Podcast & Video Highlights
   - (e) Public Company Highlights
   - (f) Earnings Call Insights
   - (g) Outlook & Implications for the Coming Weeks
7. **Output** - Saves a markdown file, styled HTML, and PDF. Emails the report via Gmail or SendGrid.

## Quick Start (Step by Step)

### Step 1: Install Node.js

Download Node.js from https://nodejs.org/ — get the **LTS** version (the big green button).

Run the installer. During installation:
- Accept the defaults
- **Check** "Automatically install necessary tools" if prompted

To verify it worked, open Command Prompt and type:
```
node --version
```
You should see something like `v18.19.0` or higher.

> **Why Node.js instead of Python?** Node.js is more commonly allowed by corporate IT departments, doesn't require admin privileges to install, and the installer is simpler.

### Step 2: Download This Project

Put all the project files in a folder on your computer, for example `C:\FreightAnalysis`.

### Step 3: Run the Setup Script

**On Windows:** Double-click `setup.bat` in the project folder.

**Or from Command Prompt:**
```
cd C:\FreightAnalysis
setup.bat
```

This will:
- Install all required packages automatically
- Create a **"Run Freight Summary.bat"** file on your Windows Desktop

### Step 4: Get Your API Keys

#### Anthropic (Claude) API Key - REQUIRED
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-...`)
6. Cost: pay-as-you-go, roughly $0.02-0.10 per weekly report

#### Financial Modeling Prep (FMP) API Key - OPTIONAL (for earnings call transcripts)
1. Go to https://financialmodelingprep.com/developer/docs/
2. Sign up for a free or paid account
3. Copy your API key from your dashboard
4. Add it to your `.env` file as `FMP_API_KEY=your-key-here`

#### SendGrid API Key - OPTIONAL (for automatic email delivery via SendGrid)
1. Go to https://signup.sendgrid.com/
2. Sign up for the **free tier** (100 emails/day)
3. Go to Settings > API Keys > Create API Key
4. Give it "Mail Send" access
5. Copy the key (starts with `SG....`)
6. **Important:** Also verify a Sender Identity at Settings > Sender Authentication (verify the email address you'll send from)

### Step 5: Configure API Keys

API keys are stored in a `.env` file (not committed to git). Copy `.env.example` to `.env` and fill in your keys:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=your-openai-key-here
APIFY_API_KEY=your-apify-key-here
GMAIL_APP_PASSWORD=your-gmail-app-password-here
FMP_API_KEY=your-fmp-key-here
```

Only `ANTHROPIC_API_KEY` is required. The others enable optional features (podcast transcription, X/Twitter scraping, email delivery, earnings transcripts).

### Step 6: Edit config.json

Open `config.json` in Notepad (right-click the file > Open with > Notepad) and:

1. **Set your email addresses** in the `email` section
2. **Add or remove YouTube channels** — just follow the existing format
3. **Add or remove podcast feeds** — just add the name and RSS URL
4. **Add or remove stock tickers** in the `stock_tickers` array

**Important:** JSON is picky about formatting. Make sure every string is in quotes, items are separated by commas, and there are no trailing commas before `]` or `}`.

### Step 7: Run It!

**Option A — Double-click "Run Freight Summary.bat"** on your Desktop.

**Option B — From Command Prompt:**
```
cd C:\FreightAnalysis
node freight_summary.js
```

The tool will show its progress step by step and generate the report automatically.

## When to Run

Run this tool **once a week** (e.g., every Friday or Monday morning). Each run takes about 2-5 minutes.

## File Structure

```
freightanalysis/
  config.json                <-- Your settings (channels, feeds, tickers)
  .env                       <-- Your API keys (not committed to git)
  .env.example               <-- Template for .env
  freight_summary.js         <-- Main script (this is what runs)
  youtube_scraper.js         <-- YouTube video + transcript fetcher
  podcast_scraper.js         <-- Podcast episode + content fetcher
  stock_news.js              <-- Stock news fetcher via Yahoo Finance RSS
  earnings_transcripts.js    <-- Earnings call transcript fetcher via FMP API
  x_scraper.js               <-- X/Twitter post scraper via Apify
  setup.bat                  <-- One-time setup (double-click to run)
  package.json               <-- Node.js package list
  README.md                  <-- This file
```

## Data Sources

| Source | API/Method | API Key Required? |
|--------|-----------|-------------------|
| YouTube | Channel page scraping + transcript extraction | No |
| Podcasts | RSS feeds + optional Whisper transcription | OpenAI key (optional, for audio transcription) |
| Stock News | Yahoo Finance RSS feeds | No |
| Earnings Transcripts | Financial Modeling Prep API | Yes (FMP_API_KEY) |
| X/Twitter | Apify scraping service | Yes (APIFY_API_KEY) |
| AI Report | Claude API (Anthropic) | Yes (ANTHROPIC_API_KEY) |

## Tracked Stock Tickers

The default configuration tracks these freight/trucking companies:

| Ticker | Company |
|--------|---------|
| ODFL | Old Dominion Freight Line |
| KNX | Knight-Swift Transportation |
| WERN | Werner Enterprises |
| SAIA | Saia Inc. |
| XPO | XPO Logistics |
| CHRW | C.H. Robinson Worldwide |
| JBHT | J.B. Hunt Transport Services |
| FDX | FedEx Corporation |
| UPS | United Parcel Service |

## Pushing Local Changes to GitHub

If you make changes to any files (e.g., editing `config.json`, updating code), use these commands to push them to your GitHub repository:

```
cd C:\Users\rbunker\freightanalysis\freightanalysis
git add -A
git commit -m "Describe your changes here"
git push
```

**What each command does:**
- `git add -A` — Stages all your changed files for commit
- `git commit -m "..."` — Saves a snapshot of your changes with a description
- `git push` — Uploads your committed changes to GitHub

**Note:** Your `.env` file (containing API keys) is in `.gitignore` and will never be pushed to GitHub.

## Troubleshooting

**"Node.js is not installed"** — Download from https://nodejs.org/ and run the installer.

**"Cannot find module"** — Run `npm install` in the project folder (or double-click `setup.bat` again).

**"Anthropic API key not set"** — Add your key to the `.env` file as `ANTHROPIC_API_KEY=sk-ant-...`.

**YouTube finds 0 videos** — The channel handle might be wrong. Go to the YouTube channel page and copy the handle from the URL (e.g., `@FreightWavesTV`).

**Email not sending** — Make sure your Gmail app password or SendGrid API key is correct. For Gmail, you need a Google App Password (not your regular password).

**No earnings transcripts** — Transcripts are only available when a company has an earnings call in the last 7 days. This is normal most weeks. Make sure your `FMP_API_KEY` is set in `.env`.

**JSON parse error in config.json** — Make sure there are no missing quotes, extra commas, or typos. Use https://jsonlint.com/ to validate your config file.

## Costs

- **Claude API:** ~$0.02-0.10 per weekly report (pay-as-you-go)
- **FMP API:** Free tier available (250 requests/day); paid plans for higher limits
- **Everything else:** Free (Node.js, YouTube transcripts, RSS feeds, Yahoo Finance, SendGrid/Gmail free tier)
