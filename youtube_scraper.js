/**
 * YouTube Scraper Module
 * ----------------------
 * What this does (in plain English):
 *   1. Takes a list of YouTube channel handles from your config file.
 *   2. For each channel, scrapes the channel page to find recent video IDs.
 *   3. For each recent video (last 7 days), downloads the transcript (captions).
 *   4. If no transcript is available, it skips that video and notes it.
 *   5. Returns an array of objects with video title, URL, channel, and transcript.
 *
 * No API key needed — this uses public YouTube pages and the free transcript API.
 */

const https = require("https");
const http = require("http");

/**
 * Make an HTTPS/HTTP GET request and return the response body as a string.
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { headers }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

/**
 * Scrape a YouTube channel page to find recent video IDs and titles.
 * We fetch the channel's /videos page HTML and extract data from the
 * embedded JSON (ytInitialData).
 */
async function getRecentVideos(channelHandle, days = 7) {
  const videos = [];
  const url = `https://www.youtube.com/${channelHandle}/videos`;

  try {
    const html = await httpGet(url, {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Extract ytInitialData JSON from the page
    const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!match) {
      console.log(`    [WARNING] Could not parse channel page for ${channelHandle}`);
      return videos;
    }

    const data = JSON.parse(match[1]);

    // Navigate the nested YouTube data structure to find video entries
    const tabs =
      data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    let videoTab = null;
    for (const tab of tabs) {
      if (tab?.tabRenderer?.title === "Videos") {
        videoTab = tab;
        break;
      }
    }

    const items =
      videoTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

    for (const item of items) {
      const renderer = item?.richItemRenderer?.content?.videoRenderer;
      if (!renderer) continue;

      const videoId = renderer.videoId;
      const title =
        renderer.title?.runs?.[0]?.text || "Unknown Title";
      const publishText =
        renderer.publishedTimeText?.simpleText || "";
      const description =
        renderer.descriptionSnippet?.runs?.map((r) => r.text).join("") || "";

      // Filter by recency
      if (!isWithinDays(publishText, days)) {
        break; // Videos are sorted newest-first
      }

      videos.push({
        video_id: videoId,
        title: title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        published: publishText,
        description: description,
      });
    }
  } catch (err) {
    console.log(
      `    [WARNING] Could not fetch videos for ${channelHandle}: ${err.message}`
    );
  }

  return videos;
}

/**
 * Parse YouTube's relative time strings ("2 days ago", "5 hours ago", etc.)
 */
function isWithinDays(publishText, days = 7) {
  const text = publishText.toLowerCase().replace("streamed ", "").trim();
  if (!text) return true;

  if (
    text.includes("just now") ||
    text.includes("second") ||
    text.includes("minute") ||
    text.includes("hour")
  ) {
    return true;
  }
  if (text.includes("day")) {
    const num = parseInt(text);
    return !isNaN(num) ? num <= days : true;
  }
  if (text.includes("week")) {
    const num = parseInt(text);
    return !isNaN(num) ? num <= 1 && days >= 7 : false;
  }
  return false; // "month", "year", etc.
}

/**
 * Fetch the transcript for a YouTube video using the youtube-transcript package.
 * Returns { text, success }.
 */
async function getTranscript(videoId) {
  try {
    // Use the youtube-transcript npm package
    const { YoutubeTranscript } = require("youtube-transcript");
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const fullText = segments.map((s) => s.text).join(" ");
    return { text: fullText, success: true };
  } catch (err) {
    return { text: null, success: false };
  }
}

/**
 * Fetch the full video description from the watch page.
 * The channel listing only has a snippet; this gets the complete text.
 */
async function getVideoDescription(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const html = await httpGet(url, {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    });

    const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!match) return null;

    const data = JSON.parse(match[1]);
    const contents =
      data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];

    for (const item of contents) {
      const desc =
        item?.videoSecondaryInfoRenderer?.attributedDescription?.content;
      if (desc) return desc;

      // Alternative location in some page layouts
      const metaDesc =
        item?.videoSecondaryInfoRenderer?.description?.runs;
      if (metaDesc) return metaDesc.map((r) => r.text).join("");
    }
  } catch {
    // Silently fail — description is a best-effort fallback
  }
  return null;
}

/**
 * Main function called by the orchestrator.
 * channels: array of { name, channel_handle } from config.json
 * Returns: array of video objects with transcript info.
 */
async function fetchYoutubeData(channels, days = 7) {
  const allVideos = [];

  for (const ch of channels) {
    console.log(`  Scanning YouTube channel: ${ch.name} (${ch.channel_handle})...`);
    const videos = await getRecentVideos(ch.channel_handle, days);
    console.log(`    Found ${videos.length} video(s) from the last ${days} days.`);

    for (const v of videos) {
      const { text, success } = await getTranscript(v.video_id);
      v.channel_name = ch.name;

      if (success) {
        v.transcript = text;
        v.transcript_status = "available";
        console.log(`    [OK] Transcript found: ${v.title}`);
      } else {
        // Try to get the full description from the video watch page as fallback
        const desc = await getVideoDescription(v.video_id);
        v.transcript = null;
        v.description = desc || v.description || null;
        v.transcript_status = "unavailable";
        if (desc) {
          console.log(`    [DESC] No transcript, using video description: ${v.title}`);
        } else {
          console.log(`    [SKIP] No transcript or description: ${v.title}`);
        }
      }

      allVideos.push(v);
    }
  }

  return allVideos;
}

module.exports = { fetchYoutubeData };
