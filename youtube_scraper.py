"""
YouTube Scraper Module
---------------------
What this does (in plain English):
  1. Takes a list of YouTube channel handles from your config file.
  2. For each channel, finds all videos uploaded in the last 7 days.
  3. For each recent video, tries to download the full transcript (captions).
  4. If no transcript is available, it notes that and moves on.
  5. Returns a list of dictionaries, each containing the video title, URL,
     channel name, publish date, and either the transcript or a note that
     it was unavailable.
"""

import datetime
import scrapetube
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)


def get_recent_videos(channel_handle, days=7):
    """
    Get videos from a YouTube channel uploaded within the last `days` days.
    Uses scrapetube which scrapes the channel page — no API key needed.
    """
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    videos = []

    try:
        # scrapetube returns an iterator of video dicts
        for video in scrapetube.get_channel(channel_url=f"https://www.youtube.com/{channel_handle}"):
            video_id = video["videoId"]
            title = video.get("title", {}).get("runs", [{}])[0].get("text", "Unknown Title")

            # Extract publish time text (e.g. "3 days ago")
            publish_text = ""
            if "publishedTimeText" in video:
                publish_text = video["publishedTimeText"].get("simpleText", "")

            # Filter: only include videos from the last 7 days
            # scrapetube doesn't give exact dates, so we parse relative time
            if not _is_within_days(publish_text, days):
                # Videos are sorted newest-first; once we pass the cutoff, stop
                break

            videos.append({
                "video_id": video_id,
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "published": publish_text,
            })
    except Exception as e:
        print(f"  [WARNING] Could not fetch videos for {channel_handle}: {e}")

    return videos


def _is_within_days(publish_text, days=7):
    """
    Parse YouTube's relative time strings like '2 days ago', '5 hours ago',
    '1 week ago' to decide if a video is within the window.
    """
    publish_text = publish_text.lower().strip()
    if not publish_text:
        return True  # If we can't tell, include it

    # "Streamed X ago" — strip the "Streamed" prefix
    publish_text = publish_text.replace("streamed ", "")

    if "just now" in publish_text or "second" in publish_text or "minute" in publish_text:
        return True
    if "hour" in publish_text:
        return True
    if "day" in publish_text:
        try:
            num = int(publish_text.split()[0])
            return num <= days
        except (ValueError, IndexError):
            return True
    if "week" in publish_text:
        try:
            num = int(publish_text.split()[0])
            return num <= 1 and days >= 7
        except (ValueError, IndexError):
            return False
    # "month", "year", etc. — too old
    return False


def get_transcript(video_id):
    """
    Attempt to download the transcript for a YouTube video.
    Returns (transcript_text, success_bool).
    """
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        # Join all text segments into one string
        full_text = " ".join(segment["text"] for segment in transcript_list)
        return full_text, True
    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable):
        return None, False
    except Exception as e:
        return None, False


def fetch_youtube_data(channels, days=7):
    """
    Main function called by the orchestrator.
    channels: list of dicts with 'name' and 'channel_handle' keys (from config.yaml)
    Returns: list of video dicts with transcript info.
    """
    all_videos = []

    for ch in channels:
        name = ch["name"]
        handle = ch["channel_handle"]
        print(f"  Scanning YouTube channel: {name} ({handle})...")

        videos = get_recent_videos(handle, days=days)
        print(f"    Found {len(videos)} video(s) from the last {days} days.")

        for v in videos:
            transcript, success = get_transcript(v["video_id"])
            v["channel_name"] = name
            if success:
                v["transcript"] = transcript
                v["transcript_status"] = "available"
                print(f"    [OK] Transcript found: {v['title']}")
            else:
                v["transcript"] = None
                v["transcript_status"] = "unavailable"
                print(f"    [SKIP] No transcript: {v['title']}")

            all_videos.append(v)

    return all_videos
