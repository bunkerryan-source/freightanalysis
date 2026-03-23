/**
 * X/Twitter Scraper via Apify
 * ============================
 * Uses the apidojo/tweet-scraper actor on Apify to pull recent posts
 * from configured X accounts. Downloads any attached images and
 * uses Claude to classify which ones are charts/data images.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const TMP_IMAGE_DIR = path.join(__dirname, ".tmp_x_images");

/**
 * Fetch tweets from an X list URL using Apify's tweet-scraper actor.
 * Returns an array of { text, date, authorHandle, imageUrls }.
 */
async function scrapeList(listUrl, apifyToken, maxTweets = 500, daysBack = 7) {
  const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const sinceDateStr = sinceDate.toISOString().split("T")[0];

  console.log(`    Scraping list: ${listUrl} (since ${sinceDateStr}, max ${maxTweets})...`);

  const actorInput = {
    listUrls: [listUrl],
    tweetsDesired: maxTweets,
    maxTweets: maxTweets,
    maxItems: maxTweets,
    searchMode: "list",
    maxRequestRetries: 3,
    addUserInfo: true,
    sinceDate: sinceDateStr,
  };

  // Step 1: Start the actor run and wait for it to finish (don't fetch dataset inline)
  const runUrl = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync?token=${apifyToken}&timeout=300`;

  const runResult = await postJSON(runUrl, actorInput);

  // Extract the dataset ID from the run result
  const datasetId = runResult?.data?.defaultDatasetId;
  if (!datasetId) {
    // Fallback: try the old endpoint in case the response shape differs
    console.log(`    [WARN] Could not get datasetId from run result. Trying fallback...`);
    return await scrapeListFallback(listUrl, apifyToken, maxTweets, daysBack, sinceDateStr, sinceDate, actorInput);
  }

  // Step 2: Fetch ALL items from the dataset with pagination
  const rawItems = await fetchAllDatasetItems(datasetId, apifyToken, maxTweets);

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    console.log(`    [WARN] No items returned from dataset. Skipping.`);
    return [];
  }

  // Map Apify output to our format
  const tweets = [];
  for (const item of rawItems) {
    const tweetDate = item.createdAt ? new Date(item.createdAt) : null;
    if (tweetDate && tweetDate < sinceDate) continue;

    const imageUrls = [];
    if (item.entities?.media) {
      for (const m of item.entities.media) {
        if (m.media_url_https) imageUrls.push(m.media_url_https);
      }
    }
    // Also check extended entities (higher-res images)
    if (item.extendedEntities?.media) {
      for (const m of item.extendedEntities.media) {
        if (m.media_url_https && !imageUrls.includes(m.media_url_https)) {
          imageUrls.push(m.media_url_https);
        }
      }
    }

    const authorHandle = item.author?.userName
      ? `@${item.author.userName}`
      : (item.user?.screen_name ? `@${item.user.screen_name}` : "@unknown");

    tweets.push({
      text: item.full_text || item.text || "",
      date: item.createdAt || "",
      authorHandle,
      imageUrls,
    });
  }

  console.log(`    [OK] List: ${tweets.length} tweet(s) from ${new Set(tweets.map(t => t.authorHandle)).size} author(s), ${tweets.reduce((n, t) => n + t.imageUrls.length, 0)} image(s).`);
  return tweets;
}

/**
 * Fetch tweets from a configured X list URL (or fall back to individual accounts).
 */
async function fetchXPosts(config, apifyToken, maxTweets = 500, daysBack = 7) {
  if (!apifyToken) {
    console.log("  [SKIP] No Apify API key configured. Skipping X/Twitter scraping.");
    return [];
  }

  const listUrl = config.x_list_url;
  if (!listUrl) {
    console.log("  [SKIP] No x_list_url configured. Skipping X/Twitter scraping.");
    return [];
  }

  try {
    return await scrapeList(listUrl, apifyToken, maxTweets, daysBack);
  } catch (err) {
    console.log(`    [ERROR] Failed to scrape list: ${err.message}`);
    return [];
  }
}

/**
 * Download all images from tweets into a temp directory.
 * Returns an array of { tweetIndex, imageUrl, localPath }.
 */
async function downloadTweetImages(tweets) {
  // Collect all images across all tweets
  const imageJobs = [];
  for (let i = 0; i < tweets.length; i++) {
    for (const url of tweets[i].imageUrls) {
      imageJobs.push({ tweetIndex: i, imageUrl: url });
    }
  }

  if (imageJobs.length === 0) return [];

  // Create temp directory
  if (!fs.existsSync(TMP_IMAGE_DIR)) {
    fs.mkdirSync(TMP_IMAGE_DIR, { recursive: true });
  }

  console.log(`  Downloading ${imageJobs.length} image(s)...`);

  const results = [];
  for (let j = 0; j < imageJobs.length; j++) {
    const { tweetIndex, imageUrl } = imageJobs[j];
    const ext = path.extname(new URL(imageUrl).pathname) || ".jpg";
    const filename = `tweet_${tweetIndex}_img_${j}${ext}`;
    const localPath = path.join(TMP_IMAGE_DIR, filename);

    try {
      await downloadFile(imageUrl, localPath);
      results.push({ tweetIndex, imageUrl, localPath });
    } catch (err) {
      console.log(`    [WARN] Failed to download ${imageUrl}: ${err.message}`);
    }
  }

  console.log(`  [OK] Downloaded ${results.length}/${imageJobs.length} image(s).`);
  return results;
}

/**
 * Use Claude to classify each image as a chart/data image or not.
 * Returns only the images classified as charts.
 */
async function filterChartImages(downloadedImages, anthropicApiKey, model) {
  if (downloadedImages.length === 0) return [];

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: anthropicApiKey });

  console.log(`  Classifying ${downloadedImages.length} image(s) with Claude...`);

  const chartImages = [];

  for (const img of downloadedImages) {
    try {
      const imageData = fs.readFileSync(img.localPath);
      const base64 = imageData.toString("base64");
      const ext = path.extname(img.localPath).toLowerCase().replace(".", "");
      const mediaType = ext === "png" ? "image/png"
        : ext === "gif" ? "image/gif"
        : ext === "webp" ? "image/webp"
        : "image/jpeg";

      const response = await client.messages.create({
        model: model,
        max_tokens: 50,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: "Is this image a chart, graph, data table, or data visualization? Reply with ONLY 'yes' or 'no'.",
            },
          ],
        }],
      });

      const answer = response.content[0]?.text?.trim().toLowerCase() || "";
      if (answer.startsWith("yes")) {
        chartImages.push(img);
      }
    } catch (err) {
      console.log(`    [WARN] Could not classify ${path.basename(img.localPath)}: ${err.message}`);
    }
  }

  console.log(`  [OK] Found ${chartImages.length} chart/data image(s) out of ${downloadedImages.length}.`);
  return chartImages;
}

/**
 * Clean up temporarily downloaded images.
 */
function cleanupTempImages() {
  if (fs.existsSync(TMP_IMAGE_DIR)) {
    const files = fs.readdirSync(TMP_IMAGE_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(TMP_IMAGE_DIR, f));
    }
    fs.rmdirSync(TMP_IMAGE_DIR);
    console.log("  [OK] Cleaned up temporary X images.");
  }
}

// ─── Fallback: original one-shot approach if run-sync doesn't return datasetId ───

async function scrapeListFallback(listUrl, apifyToken, maxTweets, daysBack, sinceDateStr, sinceDate, actorInput) {
  const runUrl = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=300&limit=${maxTweets}&clean=true`;
  const rawItems = await postJSON(runUrl, actorInput);
  if (!Array.isArray(rawItems)) {
    console.log(`    [WARN] Fallback also returned unexpected response. Skipping.`);
    return [];
  }
  return rawItems;
}

// ─── Fetch all items from an Apify dataset with pagination ───

async function fetchAllDatasetItems(datasetId, apifyToken, maxTweets) {
  const allItems = [];
  let offset = 0;
  const pageSize = 100; // Apify default max per page

  while (offset < maxTweets) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}&offset=${offset}&limit=${pageSize}&clean=true&format=json`;
    const items = await getJSON(url);

    if (!Array.isArray(items) || items.length === 0) break;

    allItems.push(...items);
    console.log(`    Fetched ${allItems.length} items so far (offset=${offset})...`);

    if (items.length < pageSize) break; // Last page
    offset += pageSize;
  }

  console.log(`    [OK] Total items fetched from dataset: ${allItems.length}`);
  return allItems;
}

// ─── HTTP Helpers ─────────────────────────────────────────────

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { "Accept": "application/json" },
    };

    const req = https.request(options, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Apify returned non-JSON (status ${res.statusCode}): ${raw.substring(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("Apify GET request timed out after 120s"));
    });
    req.end();
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error(`Apify returned non-JSON (status ${res.statusCode}): ${raw.substring(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error("Apify request timed out after 300s"));
    });
    req.write(data);
    req.end();
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const stream = fs.createWriteStream(dest);
      res.pipe(stream);
      stream.on("finish", () => { stream.close(); resolve(); });
      stream.on("error", reject);
    }).on("error", reject);
  });
}

module.exports = {
  fetchXPosts,
  downloadTweetImages,
  filterChartImages,
  cleanupTempImages,
};
