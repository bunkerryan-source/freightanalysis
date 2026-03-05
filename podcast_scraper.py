"""
Podcast Scraper Module
----------------------
What this does (in plain English):
  1. Takes a list of podcast RSS feed URLs from your config file.
  2. For each feed, finds episodes published in the last 7 days.
  3. For each episode, it tries three methods to get content:
     a) Check if the RSS feed itself contains a transcript (some do).
     b) If not, download the audio file and use OpenAI Whisper (free,
        runs on your computer) to transcribe it.
     c) If Whisper fails or is too slow, fall back to using the episode
        title + show notes/description.
  4. Notes which method was used for each episode.
"""

import os
import datetime
import tempfile
import feedparser
import requests
from dateutil import parser as dateparser


def parse_feed(rss_url, days=7):
    """
    Parse an RSS feed and return episodes from the last `days` days.
    """
    feed = feedparser.parse(rss_url)
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    episodes = []

    for entry in feed.entries:
        # Parse the publish date
        pub_date = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            pub_date = datetime.datetime(*entry.published_parsed[:6], tzinfo=datetime.timezone.utc)
        elif hasattr(entry, "published") and entry.published:
            try:
                pub_date = dateparser.parse(entry.published)
                if pub_date and pub_date.tzinfo is None:
                    pub_date = pub_date.replace(tzinfo=datetime.timezone.utc)
            except (ValueError, TypeError):
                continue

        if pub_date is None or pub_date < cutoff:
            continue

        # Find audio URL from enclosures
        audio_url = None
        if hasattr(entry, "enclosures"):
            for enc in entry.enclosures:
                if enc.get("type", "").startswith("audio/"):
                    audio_url = enc.get("href") or enc.get("url")
                    break

        # Get description / show notes
        description = ""
        if hasattr(entry, "summary"):
            description = entry.summary
        elif hasattr(entry, "description"):
            description = entry.description

        # Check for embedded transcript (some feeds include it)
        transcript_in_feed = None
        if hasattr(entry, "content"):
            for c in entry.content:
                if len(c.get("value", "")) > 500:
                    transcript_in_feed = c["value"]
                    break
        # Also check podcast:transcript tag
        if hasattr(entry, "podcast_transcript"):
            transcript_in_feed = entry.podcast_transcript

        episodes.append({
            "title": entry.get("title", "Unknown Episode"),
            "link": entry.get("link", ""),
            "published": pub_date.strftime("%Y-%m-%d"),
            "audio_url": audio_url,
            "description": description,
            "transcript_in_feed": transcript_in_feed,
        })

    return episodes


def transcribe_with_whisper(audio_url, model_name="base"):
    """
    Download the audio file and transcribe it using OpenAI Whisper locally.
    Returns (transcript_text, success_bool).
    """
    try:
        import whisper
    except ImportError:
        print("    [INFO] Whisper not installed. Falling back to show notes.")
        return None, False

    # Download audio to a temp file
    tmp_path = None
    try:
        print("    Downloading audio for Whisper transcription...")
        response = requests.get(audio_url, stream=True, timeout=120)
        response.raise_for_status()

        # Save to a temp file
        suffix = ".mp3"
        if "audio/mp4" in response.headers.get("Content-Type", ""):
            suffix = ".m4a"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = tmp.name
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                tmp.write(chunk)

        print(f"    Transcribing with Whisper ({model_name} model)... This may take a few minutes.")
        model = whisper.load_model(model_name)
        result = model.transcribe(tmp_path)
        return result["text"], True

    except Exception as e:
        print(f"    [WARNING] Whisper transcription failed: {e}")
        return None, False
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


def _strip_html(text):
    """Remove HTML tags from a string (basic approach)."""
    import re
    return re.sub(r"<[^>]+>", "", text)


def fetch_podcast_data(feeds, days=7, whisper_model="base"):
    """
    Main function called by the orchestrator.
    feeds: list of dicts with 'name' and 'rss_url' keys (from config.yaml)
    Returns: list of episode dicts with transcript info.
    """
    all_episodes = []

    for feed_info in feeds:
        name = feed_info["name"]
        rss_url = feed_info["rss_url"]
        print(f"  Scanning podcast: {name}...")

        episodes = parse_feed(rss_url, days=days)
        print(f"    Found {len(episodes)} episode(s) from the last {days} days.")

        for ep in episodes:
            ep["podcast_name"] = name

            # Method 1: Transcript already in the RSS feed
            if ep["transcript_in_feed"]:
                ep["transcript"] = _strip_html(ep["transcript_in_feed"])
                ep["transcript_method"] = "rss_feed"
                print(f"    [OK] Transcript from RSS: {ep['title']}")

            # Method 2: Whisper transcription
            elif ep["audio_url"]:
                transcript, success = transcribe_with_whisper(ep["audio_url"], whisper_model)
                if success:
                    ep["transcript"] = transcript
                    ep["transcript_method"] = "whisper"
                    print(f"    [OK] Whisper transcript: {ep['title']}")
                else:
                    # Method 3: Fall back to title + description
                    ep["transcript"] = f"Title: {ep['title']}\n\nShow Notes:\n{_strip_html(ep['description'])}"
                    ep["transcript_method"] = "show_notes_fallback"
                    print(f"    [FALLBACK] Using show notes: {ep['title']}")
            else:
                # No audio URL and no transcript — use description
                ep["transcript"] = f"Title: {ep['title']}\n\nShow Notes:\n{_strip_html(ep['description'])}"
                ep["transcript_method"] = "show_notes_fallback"
                print(f"    [FALLBACK] Using show notes: {ep['title']}")

            # Clean up temporary fields
            del ep["transcript_in_feed"]
            all_episodes.append(ep)

    return all_episodes
