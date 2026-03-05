"""
Freight Market Summary Tool - Main Orchestrator
================================================
What this does (in plain English):
  This is the main script you run each week. It:
  1. Reads your config file (config.yaml) for channels, feeds, tickers, and keys.
  2. Pulls YouTube videos and transcripts from the last 7 days.
  3. Pulls podcast episodes and transcripts from the last 7 days.
  4. Pulls stock news for freight/trucking companies.
  5. Asks you to paste in any X/Twitter posts you want included.
  6. Sends everything to the Claude AI API to generate a structured weekly report.
  7. Saves the report as a markdown file with today's date.
  8. Prints the report to your screen.
  9. Emails the report to you via SendGrid.

How to run it:
  python freight_summary.py
"""

import os
import sys
import datetime
import yaml
import anthropic
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import (
    Mail,
    Attachment,
    FileContent,
    FileName,
    FileType,
    Disposition,
)
import base64

from youtube_scraper import fetch_youtube_data
from podcast_scraper import fetch_podcast_data
from stock_news import fetch_stock_news


def load_config(config_path="config.yaml"):
    """Load the YAML configuration file."""
    # Look for config.yaml in the same directory as this script
    if not os.path.isabs(config_path):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, config_path)

    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def collect_twitter_input():
    """
    Ask the user to paste in X/Twitter posts or quotes.
    Waits for the user to finish before proceeding.
    """
    print("\n" + "=" * 60)
    print("MANUAL X/TWITTER INPUT")
    print("=" * 60)
    print("Paste any X/Twitter posts or quotes you want included in the report.")
    print("When you're done, type 'DONE' on a new line and press Enter.")
    print("If you have nothing to add, just type 'DONE' and press Enter.")
    print("-" * 60)

    lines = []
    while True:
        try:
            line = input()
            if line.strip().upper() == "DONE":
                break
            lines.append(line)
        except EOFError:
            break

    text = "\n".join(lines).strip()
    if text:
        print(f"\n  [OK] Captured {len(lines)} line(s) of X/Twitter input.")
    else:
        print("\n  [INFO] No X/Twitter input provided. Continuing without it.")
    return text


def build_prompt(youtube_data, podcast_data, stock_data, twitter_input):
    """
    Build the prompt that will be sent to Claude to generate the report.
    """
    today = datetime.date.today().strftime("%B %d, %Y")
    week_ago = (datetime.date.today() - datetime.timedelta(days=7)).strftime("%B %d, %Y")

    prompt = f"""You are a freight and trucking industry analyst. Based on the data below,
generate a comprehensive weekly freight market summary for the week of {week_ago} to {today}.

Structure the report with these exact sections:
## (a) Market Conditions Overview
## (b) Key Events of the Week
## (c) What the Industry is Talking About
## (d) Podcast & Video Highlights
## (e) Public Company Highlights
## (f) Outlook & Implications for the Coming Weeks

Guidelines:
- Write in a professional but accessible tone.
- Cite specific sources (video titles, podcast names, company tickers) when referencing information.
- If data is thin in any area, note that and still provide useful analysis based on what's available.
- For the Public Company Highlights section, organize by ticker symbol.
- Keep the total report between 1500-3000 words.

---

### YOUTUBE VIDEO DATA
"""

    if youtube_data:
        for v in youtube_data:
            prompt += f"\n**Channel:** {v['channel_name']}\n"
            prompt += f"**Title:** {v['title']}\n"
            prompt += f"**Published:** {v['published']}\n"
            prompt += f"**URL:** {v['url']}\n"
            if v["transcript"]:
                # Truncate very long transcripts to stay within token limits
                transcript = v["transcript"][:8000]
                prompt += f"**Transcript:** {transcript}\n"
            else:
                prompt += f"**Transcript:** [Unavailable]\n"
            prompt += "\n---\n"
    else:
        prompt += "\n[No YouTube videos found for this period.]\n"

    prompt += "\n\n### PODCAST EPISODE DATA\n"

    if podcast_data:
        for ep in podcast_data:
            prompt += f"\n**Podcast:** {ep['podcast_name']}\n"
            prompt += f"**Title:** {ep['title']}\n"
            prompt += f"**Published:** {ep['published']}\n"
            prompt += f"**Transcript Method:** {ep['transcript_method']}\n"
            if ep["transcript"]:
                transcript = ep["transcript"][:8000]
                prompt += f"**Content:** {transcript}\n"
            prompt += "\n---\n"
    else:
        prompt += "\n[No podcast episodes found for this period.]\n"

    prompt += "\n\n### STOCK NEWS DATA\n"

    if stock_data:
        for item in stock_data:
            prompt += f"\n**Ticker:** {item['ticker']}\n"
            prompt += f"**Headline:** {item['title']}\n"
            prompt += f"**Published:** {item['published']}\n"
            if item["summary"]:
                prompt += f"**Summary:** {item['summary']}\n"
            prompt += "\n---\n"
    else:
        prompt += "\n[No stock news found for this period.]\n"

    prompt += "\n\n### X/TWITTER INPUT\n"

    if twitter_input:
        prompt += f"\n{twitter_input}\n"
    else:
        prompt += "\n[No X/Twitter input provided.]\n"

    return prompt


def generate_report(prompt, api_key):
    """
    Send the collected data to Claude and get back the structured report.
    """
    print("\n  Sending data to Claude API for synthesis...")

    client = anthropic.Anthropic(api_key=api_key)

    today = datetime.date.today().strftime("%B %d, %Y")
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        system=f"You are a freight and trucking industry analyst producing a weekly market summary report dated {today}. Write in markdown format.",
    )

    # Extract the text from the response
    report_text = ""
    for block in message.content:
        if block.type == "text":
            report_text += block.text

    return report_text


def save_report(report_text):
    """
    Save the report as a markdown file with today's date in the filename.
    Returns the file path.
    """
    today = datetime.date.today().strftime("%Y-%m-%d")
    filename = f"freight_summary_{today}.md"
    script_dir = os.path.dirname(os.path.abspath(__file__))
    filepath = os.path.join(script_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"# Weekly Freight Market Summary\n")
        f.write(f"**Week ending {today}**\n\n")
        f.write(report_text)

    return filepath


def send_email(report_text, filepath, config):
    """
    Send the report via SendGrid email.
    Includes the full report in the email body and attaches the markdown file.
    """
    sg_api_key = config["api_keys"]["sendgrid_api_key"]
    if sg_api_key == "YOUR_SENDGRID_API_KEY_HERE":
        print("\n  [SKIP] SendGrid API key not configured. Skipping email.")
        print("  To enable email, add your SendGrid API key to config.yaml.")
        return False

    email_config = config.get("email", {})
    from_email = email_config.get("from_email", "freight-summary@example.com")
    to_email = email_config.get("to_email", "you@example.com")
    subject_prefix = email_config.get("subject_prefix", "Weekly Freight Market Summary")
    today = datetime.date.today().strftime("%Y-%m-%d")

    # Build the email
    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=f"{subject_prefix} - {today}",
        html_content=_markdown_to_basic_html(report_text),
    )

    # Attach the markdown file
    with open(filepath, "r", encoding="utf-8") as f:
        file_data = f.read()

    encoded_file = base64.b64encode(file_data.encode("utf-8")).decode("utf-8")
    attachment = Attachment(
        FileContent(encoded_file),
        FileName(os.path.basename(filepath)),
        FileType("text/markdown"),
        Disposition("attachment"),
    )
    message.attachment = attachment

    try:
        sg = SendGridAPIClient(sg_api_key)
        response = sg.send(message)
        print(f"\n  [OK] Email sent! Status code: {response.status_code}")
        return True
    except Exception as e:
        print(f"\n  [ERROR] Failed to send email: {e}")
        return False


def _markdown_to_basic_html(md_text):
    """
    Very basic markdown-to-HTML conversion for email body.
    Just enough to make it readable — not a full parser.
    """
    import re
    html = md_text
    # Headers
    html = re.sub(r"^### (.+)$", r"<h3>\1</h3>", html, flags=re.MULTILINE)
    html = re.sub(r"^## (.+)$", r"<h2>\1</h2>", html, flags=re.MULTILINE)
    html = re.sub(r"^# (.+)$", r"<h1>\1</h1>", html, flags=re.MULTILINE)
    # Bold
    html = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", html)
    # Line breaks
    html = html.replace("\n\n", "</p><p>")
    html = html.replace("\n", "<br>")
    html = f"<div style='font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;'><p>{html}</p></div>"
    return html


def main():
    print("=" * 60)
    print("  WEEKLY FREIGHT MARKET SUMMARY TOOL")
    print("=" * 60)
    print()

    # Step 1: Load config
    print("[1/7] Loading configuration...")
    try:
        config = load_config()
    except FileNotFoundError:
        print("  [ERROR] config.yaml not found!")
        print("  Make sure config.yaml is in the same folder as this script.")
        sys.exit(1)
    except yaml.YAMLError as e:
        print(f"  [ERROR] Problem reading config.yaml: {e}")
        sys.exit(1)

    # Validate API key
    api_key = config.get("api_keys", {}).get("anthropic_api_key", "")
    if not api_key or api_key == "YOUR_ANTHROPIC_API_KEY_HERE":
        print("  [ERROR] Anthropic API key not set in config.yaml!")
        print("  Get your key at: https://console.anthropic.com/")
        sys.exit(1)

    print("  [OK] Config loaded.\n")

    # Step 2: YouTube
    print("[2/7] Fetching YouTube data...")
    youtube_channels = config.get("youtube_channels", [])
    youtube_data = fetch_youtube_data(youtube_channels)
    print(f"  Total: {len(youtube_data)} video(s) collected.\n")

    # Step 3: Podcasts
    print("[3/7] Fetching podcast data...")
    podcast_feeds = config.get("podcast_feeds", [])
    whisper_model = config.get("whisper_model", "base")
    podcast_data = fetch_podcast_data(podcast_feeds, whisper_model=whisper_model)
    print(f"  Total: {len(podcast_data)} episode(s) collected.\n")

    # Step 4: Stock news
    print("[4/7] Fetching stock news...")
    tickers = config.get("stock_tickers", [])
    stock_data = fetch_stock_news(tickers)
    print(f"  Total: {len(stock_data)} news item(s) collected.\n")

    # Step 5: Twitter input
    print("[5/7] Collecting X/Twitter input...")
    twitter_input = collect_twitter_input()

    # Step 6: Generate report with Claude
    print("\n[6/7] Generating report with Claude AI...")
    prompt = build_prompt(youtube_data, podcast_data, stock_data, twitter_input)
    report = generate_report(prompt, api_key)

    # Step 7: Save and output
    print("\n[7/7] Saving and delivering report...")
    filepath = save_report(report)
    print(f"  [OK] Report saved to: {filepath}")

    # Print to screen
    print("\n" + "=" * 60)
    print("  WEEKLY FREIGHT MARKET SUMMARY")
    print("=" * 60)
    print()
    print(report)
    print()
    print("=" * 60)

    # Send email
    send_email(report, filepath, config)

    print("\n  Done! Your weekly freight summary is ready.")
    print(f"  File: {filepath}")
    print("=" * 60)


if __name__ == "__main__":
    main()
