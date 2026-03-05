# Weekly Freight Market Summary Tool

A tool that automatically collects freight/trucking industry data from YouTube, podcasts, stock news, and your X/Twitter input, then uses Claude AI to generate a structured weekly market summary.

**No Python required.** Uses Node.js, which is typically allowed by IT departments and easy to install.

## What It Does

Every time you run it, the tool:

1. **YouTube** - Pulls the last 7 days of videos from your configured freight/trucking channels and extracts transcripts.
2. **Podcasts** - Pulls the last 7 days of episodes from your RSS feeds. Uses episode descriptions and show notes from the feed. If the feed contains full content, it uses that.
3. **Stock News** - Pulls the last 7 days of news for ODFL, KNX, WERN, SAIA, XPO, CHRW, JBHT via Yahoo Finance RSS (free).
4. **X/Twitter** - Asks you to paste in any posts or quotes before generating the report.
5. **AI Report** - Sends everything to Claude and generates a report with these sections:
   - (a) Market Conditions Overview
   - (b) Key Events of the Week
   - (c) What the Industry is Talking About
   - (d) Podcast & Video Highlights
   - (e) Public Company Highlights
   - (f) Outlook & Implications for the Coming Weeks
6. **Output** - Saves a markdown file, prints to screen, and emails it via SendGrid.

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

You need **two** API keys (one is optional):

#### Anthropic (Claude) API Key - REQUIRED
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-...`)
6. Cost: pay-as-you-go, roughly $0.02-0.10 per weekly report

#### SendGrid API Key - OPTIONAL (for automatic email delivery)
1. Go to https://signup.sendgrid.com/
2. Sign up for the **free tier** (100 emails/day)
3. Go to Settings > API Keys > Create API Key
4. Give it "Mail Send" access
5. Copy the key (starts with `SG....`)
6. **Important:** Also verify a Sender Identity at Settings > Sender Authentication (verify the email address you'll send from)

### Step 5: Edit config.json

Open `config.json` in Notepad (right-click the file > Open with > Notepad) and:

1. **Paste your Anthropic API key** where it says `YOUR_ANTHROPIC_API_KEY_HERE`
2. **Paste your SendGrid key** where it says `YOUR_SENDGRID_API_KEY_HERE` (or leave it if you don't want email)
3. **Set your email addresses** in the `email` section
4. **Add or remove YouTube channels** — just follow the existing format
5. **Add or remove podcast feeds** — just add the name and RSS URL
6. **Add or remove stock tickers** in the `stock_tickers` array

**Important:** JSON is picky about formatting. Make sure every string is in quotes, items are separated by commas, and there are no trailing commas before `]` or `}`.

### Step 6: Run It!

**Option A — Double-click "Run Freight Summary.bat"** on your Desktop.

**Option B — From Command Prompt:**
```
cd C:\FreightAnalysis
node freight_summary.js
```

The tool will show its progress step by step and ask you to paste in any X/Twitter posts before generating the report. When it asks for X/Twitter input, paste your content and type `DONE` on a new line.

## When to Run

Run this tool **once a week** (e.g., every Friday or Monday morning). Each run takes about 2-5 minutes.

## File Structure

```
freightanalysis/
  config.json            <-- Your settings (channels, feeds, API keys)
  freight_summary.js     <-- Main script (this is what runs)
  youtube_scraper.js     <-- YouTube video + transcript fetcher
  podcast_scraper.js     <-- Podcast episode + content fetcher
  stock_news.js          <-- Stock news fetcher via Yahoo Finance RSS
  setup.bat              <-- One-time setup (double-click to run)
  package.json           <-- Node.js package list
  README.md              <-- This file
```

## Troubleshooting

**"Node.js is not installed"** — Download from https://nodejs.org/ and run the installer.

**"Cannot find module"** — Run `npm install` in the project folder (or double-click `setup.bat` again).

**"Anthropic API key not set"** — Open `config.json` in Notepad and paste your key.

**YouTube finds 0 videos** — The channel handle might be wrong. Go to the YouTube channel page and copy the handle from the URL (e.g., `@FreightWavesTV`).

**Email not sending** — Make sure your SendGrid API key is correct and you verified your sender email address in the SendGrid dashboard.

**JSON parse error in config.json** — Make sure there are no missing quotes, extra commas, or typos. Use https://jsonlint.com/ to validate your config file.

## Costs

- **Claude API:** ~$0.02-0.10 per weekly report (pay-as-you-go)
- **Everything else:** Free (Node.js, YouTube transcripts, RSS feeds, Yahoo Finance, SendGrid free tier)
