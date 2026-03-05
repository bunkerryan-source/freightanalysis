# Weekly Freight Market Summary Tool

A Python tool that automatically collects freight/trucking industry data from YouTube, podcasts, stock news, and your X/Twitter input, then uses Claude AI to generate a structured weekly market summary.

## What It Does

Every time you run it, the tool:

1. **YouTube** - Pulls the last 7 days of videos from your configured freight/trucking channels and extracts transcripts.
2. **Podcasts** - Pulls the last 7 days of episodes from your RSS feeds. Tries to get transcripts from the feed first, then uses Whisper (free, local) to transcribe audio, or falls back to show notes.
3. **Stock News** - Pulls the last 7 days of news for ODFL, KNX, WERN, SAIA, XPO, CHRW, JBHT via Yahoo Finance.
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

### Step 1: Make Sure Python is Installed

You need Python 3.9 or newer. To check, open a Command Prompt (Windows) or Terminal (Mac/Linux) and type:

```
python --version
```

If you don't have Python, download it from https://www.python.org/downloads/ and install it. **Check the box that says "Add Python to PATH" during installation.**

### Step 2: Download This Project

Put all the project files in a folder on your computer (e.g., `C:\FreightAnalysis` on Windows or `~/freightanalysis` on Mac/Linux).

### Step 3: Run the Setup Script

Open a Command Prompt / Terminal, navigate to the project folder, and run:

```
cd C:\FreightAnalysis
python setup.py
```

This will:
- Install all required Python packages automatically
- Check if Whisper (audio transcription) is working
- Create a **"Run Freight Summary.bat"** file on your Windows Desktop
- Print instructions for getting your API keys

### Step 4: Get Your API Keys

You need **two** API keys (one is optional):

#### Anthropic (Claude) API Key - REQUIRED
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Click "API Keys" in the left sidebar
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-...`)

#### SendGrid API Key - OPTIONAL (for email delivery)
1. Go to https://signup.sendgrid.com/
2. Sign up for the **free tier** (100 emails/day)
3. Go to Settings > API Keys > Create API Key
4. Give it "Mail Send" access
5. Copy the key (starts with `SG....`)
6. **Important:** Also verify a Sender Identity at Settings > Sender Authentication

### Step 5: Edit config.yaml

Open `config.yaml` in any text editor (Notepad works fine) and:

1. **Paste your API keys** where it says `YOUR_ANTHROPIC_API_KEY_HERE` and `YOUR_SENDGRID_API_KEY_HERE`
2. **Set your email addresses** under the `email:` section
3. **Add or remove YouTube channels** under `youtube_channels:` — just copy the format
4. **Add or remove podcast feeds** under `podcast_feeds:` — just add the RSS URL
5. **Add or remove stock tickers** under `stock_tickers:`

### Step 6: Run It!

**Option A — Double-click the .bat file** on your Desktop (Windows only).

**Option B — From the command line:**
```
python freight_summary.py
```

The tool will show its progress step by step and ask you to paste in any X/Twitter posts before generating the report.

## When to Run

Run this tool **once a week** (e.g., every Friday or Monday morning) to get your weekly summary. Each run takes 2-10 minutes depending on how many podcasts need Whisper transcription.

## File Structure

```
freightanalysis/
  config.yaml            <-- Your settings (channels, feeds, API keys)
  freight_summary.py     <-- Main script (run this)
  youtube_scraper.py     <-- YouTube video + transcript fetcher
  podcast_scraper.py     <-- Podcast episode + transcript fetcher
  stock_news.py          <-- Stock news fetcher via Yahoo Finance
  setup.py               <-- One-time setup script
  requirements.txt       <-- Python package list
  README.md              <-- This file
```

## Troubleshooting

**"ModuleNotFoundError"** — Run `pip install -r requirements.txt` again.

**"Whisper not installed"** — You need ffmpeg. On Windows: `winget install ffmpeg`. On Mac: `brew install ffmpeg`. The tool still works without Whisper (uses show notes instead).

**"Anthropic API key not set"** — Edit `config.yaml` and paste your key.

**YouTube finds 0 videos** — The channel handle might be wrong. Go to the YouTube channel and copy the handle from the URL (e.g., `@FreightWavesTV`).

**Email not sending** — Make sure your SendGrid API key is correct and you verified your sender email in SendGrid's dashboard.

## Costs

- **Claude API:** ~$0.02-0.10 per weekly report (pay-as-you-go)
- **Everything else:** Free (YouTube transcripts, RSS feeds, Yahoo Finance, Whisper, SendGrid free tier)
