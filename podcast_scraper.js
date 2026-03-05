/**
 * Podcast Scraper Module
 * ----------------------
 * What this does (in plain English):
 *   1. Takes a list of podcast RSS feed URLs from your config file.
 *   2. For each feed, finds episodes published in the last 7 days.
 *   3. For each episode, it tries to get content in this order:
 *      a) Check if the RSS feed contains a transcript or long description.
 *      b) If not, use the episode title + show notes/description as a fallback.
 *   4. Notes which method was used for each episode.
 *
 * NOTE: Since we can't use Python Whisper without Python, audio transcription
 * is handled differently. If you want AI transcription, you can paste key
 * quotes into the X/Twitter input step, or use a free online transcription
 * service and add the text to the config. The tool will still capture all
 * episode metadata and show notes, which Claude uses effectively.
 */

const https = require("https");
const http = require("http");
const { parseString } = require("xml2js");

/**
 * Make an HTTP/HTTPS GET request and return the body as a string.
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "FreightSummaryBot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
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
 * Parse XML string into a JavaScript object.
 */
function parseXml(xmlString) {
  return new Promise((resolve, reject) => {
    parseString(xmlString, { explicitArray: false, trim: true }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(text) {
  if (!text) return "";
  return text.replace(/<[^>]+>/g, "").trim();
}

/**
 * Parse a date string and check if it's within the last N days.
 */
function isWithinDays(dateStr, days) {
  try {
    const pubDate = new Date(dateStr);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return pubDate >= cutoff;
  } catch {
    return false;
  }
}

/**
 * Parse an RSS feed and return episodes from the last N days.
 */
async function parseFeed(rssUrl, days = 7) {
  const episodes = [];

  try {
    const xmlText = await httpGet(rssUrl);
    const parsed = await parseXml(xmlText);

    // RSS feeds have items under rss.channel.item
    const channel = parsed?.rss?.channel;
    if (!channel) return episodes;

    let items = channel.item || [];
    if (!Array.isArray(items)) items = [items];

    for (const item of items) {
      // Get publish date
      const pubDate = item.pubDate || item["dc:date"] || "";
      if (!pubDate || !isWithinDays(pubDate, days)) continue;

      const formattedDate = new Date(pubDate).toISOString().split("T")[0];

      // Get description / show notes
      let description = "";
      if (item["content:encoded"]) {
        description =
          typeof item["content:encoded"] === "string"
            ? item["content:encoded"]
            : item["content:encoded"]._ || "";
      } else if (item.description) {
        description =
          typeof item.description === "string"
            ? item.description
            : item.description._ || "";
      } else if (item.summary) {
        description =
          typeof item.summary === "string"
            ? item.summary
            : item.summary._ || "";
      }

      // Get audio URL from enclosure
      let audioUrl = null;
      if (item.enclosure) {
        const enc = Array.isArray(item.enclosure)
          ? item.enclosure[0]
          : item.enclosure;
        audioUrl = enc?.$?.url || enc?.url || null;
      }

      // Check if description is long enough to count as a "transcript"
      const cleanDesc = stripHtml(description);
      const hasLongContent = cleanDesc.length > 1000;

      episodes.push({
        title: item.title || "Unknown Episode",
        link: item.link || "",
        published: formattedDate,
        audio_url: audioUrl,
        description: cleanDesc,
        has_long_content: hasLongContent,
      });
    }
  } catch (err) {
    console.log(`    [WARNING] Could not parse feed: ${err.message}`);
  }

  return episodes;
}

/**
 * Main function called by the orchestrator.
 * feeds: array of { name, rss_url } from config.json
 * Returns: array of episode objects with content info.
 */
async function fetchPodcastData(feeds, days = 7) {
  const allEpisodes = [];

  for (const feedInfo of feeds) {
    console.log(`  Scanning podcast: ${feedInfo.name}...`);
    const episodes = await parseFeed(feedInfo.rss_url, days);
    console.log(
      `    Found ${episodes.length} episode(s) from the last ${days} days.`
    );

    for (const ep of episodes) {
      ep.podcast_name = feedInfo.name;

      if (ep.has_long_content) {
        // The RSS feed has substantial content — use it as the "transcript"
        ep.transcript = ep.description;
        ep.transcript_method = "rss_content";
        console.log(`    [OK] Rich content from RSS: ${ep.title}`);
      } else if (ep.description) {
        // Use title + show notes as fallback
        ep.transcript = `Title: ${ep.title}\n\nShow Notes:\n${ep.description}`;
        ep.transcript_method = "show_notes";
        console.log(`    [NOTES] Using show notes: ${ep.title}`);
      } else {
        ep.transcript = `Title: ${ep.title}`;
        ep.transcript_method = "title_only";
        console.log(`    [MINIMAL] Title only: ${ep.title}`);
      }

      // Clean up temporary fields
      delete ep.has_long_content;
      allEpisodes.push(ep);
    }
  }

  return allEpisodes;
}

module.exports = { fetchPodcastData };
