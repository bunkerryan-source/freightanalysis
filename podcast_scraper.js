/**
 * Podcast Scraper Module
 * ----------------------
 * What this does (in plain English):
 *   1. Takes a list of podcast RSS feed URLs from your config file.
 *   2. For each feed, finds episodes published in the last 7 days.
 *   3. For each episode, it tries to get content in this order:
 *      a) Check if the RSS feed contains a transcript or long description.
 *      b) If not, download the audio and transcribe it via OpenAI Whisper API.
 *      c) If Whisper fails or no API key, fall back to show notes/description.
 *   4. Notes which method was used for each episode.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
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
 * Download a file (binary) from a URL to a local path.
 */
function downloadFile(url, destPath, maxSizeMB = 200) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "FreightSummaryBot/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, maxSizeMB).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const maxBytes = maxSizeMB * 1024 * 1024;
      let totalBytes = 0;
      const file = fs.createWriteStream(destPath);

      res.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          res.destroy();
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`File exceeds ${maxSizeMB}MB limit`));
          return;
        }
        file.write(chunk);
      });

      res.on("end", () => {
        file.end(() => resolve(destPath));
      });

      res.on("error", (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    });
    req.on("error", reject);
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error("Download timed out"));
    });
  });
}

/**
 * Split a file into chunks of up to chunkSizeMB megabytes.
 * Returns an array of chunk file paths.
 */
function splitFile(filePath, chunkSizeMB = 24) {
  const chunkSize = chunkSizeMB * 1024 * 1024;
  const fileSize = fs.statSync(filePath).size;

  if (fileSize <= chunkSize) return [filePath];

  const chunks = [];
  const buffer = fs.readFileSync(filePath);
  let offset = 0;
  let index = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + chunkSize, fileSize);
    const chunkPath = filePath.replace(".mp3", `_chunk${index}.mp3`);
    fs.writeFileSync(chunkPath, buffer.slice(offset, end));
    chunks.push(chunkPath);
    offset = end;
    index++;
  }

  return chunks;
}

/**
 * Transcribe an audio file using the OpenAI Whisper API.
 * Returns the transcript text or null on failure.
 */
async function transcribeWithWhisper(audioPath, openaiApiKey) {
  // Build multipart form data manually (no external dependency needed)
  const boundary = "----FreightSummaryBoundary" + Date.now();
  const audioData = fs.readFileSync(audioPath);
  const filename = path.basename(audioPath);

  // Construct multipart body
  const parts = [];

  // model field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
  ));

  // file field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
  ));
  parts.push(audioData);
  parts.push(Buffer.from("\r\n"));

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.openai.com",
      path: "/v1/audio/transcriptions",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiApiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          if (result.text) {
            resolve(result.text);
          } else {
            reject(new Error(result.error?.message || "No transcript in response"));
          }
        } catch (err) {
          reject(new Error("Failed to parse Whisper response"));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error("Whisper API request timed out"));
    });

    req.write(body);
    req.end();
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

      // Check for podcast:transcript tag (Podcasting 2.0 standard)
      let rssTranscript = null;
      if (item["podcast:transcript"]) {
        const transcriptTag = Array.isArray(item["podcast:transcript"])
          ? item["podcast:transcript"][0]
          : item["podcast:transcript"];
        const transcriptUrl = transcriptTag?.$?.url || transcriptTag?.url;
        if (transcriptUrl) {
          try {
            rssTranscript = await httpGet(transcriptUrl);
            rssTranscript = stripHtml(rssTranscript).trim();
          } catch {
            // Transcript URL failed, will try other methods
          }
        }
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
        rss_transcript: rssTranscript,
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
 * openaiApiKey: OpenAI API key for Whisper transcription (optional)
 * Returns: array of episode objects with content info.
 */
async function fetchPodcastData(feeds, days = 7, openaiApiKey = null) {
  const allEpisodes = [];
  const tempDir = path.join(__dirname, ".tmp_audio");

  // Create temp directory for audio downloads if we have a Whisper key
  if (openaiApiKey && !fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  for (const feedInfo of feeds) {
    console.log(`  Scanning podcast: ${feedInfo.name}...`);
    const episodes = await parseFeed(feedInfo.rss_url, days);
    console.log(
      `    Found ${episodes.length} episode(s) from the last ${days} days.`
    );

    for (const ep of episodes) {
      ep.podcast_name = feedInfo.name;

      // Priority 1: RSS transcript tag (Podcasting 2.0)
      if (ep.rss_transcript && ep.rss_transcript.length > 500) {
        ep.transcript = ep.rss_transcript;
        ep.transcript_method = "rss_transcript_tag";
        console.log(`    [OK] Transcript from RSS tag: ${ep.title}`);
      }
      // Priority 2: Rich content from RSS description
      else if (ep.has_long_content) {
        ep.transcript = ep.description;
        ep.transcript_method = "rss_content";
        console.log(`    [OK] Rich content from RSS: ${ep.title}`);
      }
      // Priority 3: Whisper transcription from audio
      else if (openaiApiKey && ep.audio_url) {
        console.log(`    [WHISPER] Downloading audio for transcription: ${ep.title}`);
        const audioFile = path.join(tempDir, `episode_${Date.now()}.mp3`);
        const chunkFiles = [];
        try {
          await downloadFile(ep.audio_url, audioFile);
          const fileSizeMB = (fs.statSync(audioFile).size / (1024 * 1024)).toFixed(1);
          console.log(`    [WHISPER] Downloaded ${fileSizeMB}MB. Preparing for transcription...`);

          const chunks = splitFile(audioFile, 24);
          chunkFiles.push(...chunks);

          if (chunks.length > 1) {
            console.log(`    [WHISPER] Split into ${chunks.length} chunks for Whisper API...`);
          }

          const transcriptParts = [];
          for (let i = 0; i < chunks.length; i++) {
            if (chunks.length > 1) {
              console.log(`    [WHISPER] Transcribing chunk ${i + 1}/${chunks.length}...`);
            } else {
              console.log(`    [WHISPER] Transcribing with OpenAI Whisper...`);
            }
            const text = await transcribeWithWhisper(chunks[i], openaiApiKey);
            transcriptParts.push(text);
          }

          ep.transcript = transcriptParts.join(" ");
          ep.transcript_method = "whisper";
          console.log(`    [OK] Whisper transcript received: ${ep.title} (${ep.transcript.length} chars)`);
        } catch (err) {
          console.log(`    [WARNING] Whisper transcription failed: ${err.message}`);
          // Fall back to show notes
          if (ep.description) {
            ep.transcript = `Title: ${ep.title}\n\nShow Notes:\n${ep.description}`;
            ep.transcript_method = "show_notes";
            console.log(`    [NOTES] Falling back to show notes: ${ep.title}`);
          } else {
            ep.transcript = `Title: ${ep.title}`;
            ep.transcript_method = "title_only";
            console.log(`    [MINIMAL] Title only: ${ep.title}`);
          }
        } finally {
          // Clean up all downloaded/chunk files
          for (const f of [audioFile, ...chunkFiles]) {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          }
        }
      }
      // Priority 4: Show notes fallback
      else if (ep.description) {
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
      delete ep.rss_transcript;
      allEpisodes.push(ep);
    }
  }

  // Clean up temp directory
  if (fs.existsSync(tempDir)) {
    try { fs.rmdirSync(tempDir); } catch { /* non-empty or already removed */ }
  }

  return allEpisodes;
}

module.exports = { fetchPodcastData };
