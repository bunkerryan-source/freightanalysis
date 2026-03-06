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
 * Fetch tweets from a single X account using Apify's tweet-scraper actor.
 * Returns an array of { text, date, authorHandle, imageUrls }.
 */
async function scrapeAccount(handle, apifyToken, maxTweets = 50, daysBack = 7) {
  const cleanHandle = handle.replace(/^@/, "");
  const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  const sinceDateStr = sinceDate.toISOString().split("T")[0];

  console.log(`    Scraping @${cleanHandle} (since ${sinceDateStr}, max ${maxTweets})...`);

  const actorInput = {
    handles: [cleanHandle],
    tweetsDesired: maxTweets,
    searchMode: "user",
    maxRequestRetries: 3,
    addUserInfo: false,
    sinceDate: sinceDateStr,
  };

  // Start the actor run and wait for it to finish
  const runUrl = `https://api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=120`;

  const rawItems = await postJSON(runUrl, actorInput);

  if (!Array.isArray(rawItems)) {
    console.log(`    [WARN] Unexpected response for @${cleanHandle}. Skipping.`);
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

    tweets.push({
      text: item.full_text || item.text || "",
      date: item.createdAt || "",
      authorHandle: `@${cleanHandle}`,
      imageUrls,
    });
  }

  console.log(`    [OK] @${cleanHandle}: ${tweets.length} tweet(s), ${tweets.reduce((n, t) => n + t.imageUrls.length, 0)} image(s).`);
  return tweets;
}

/**
 * Fetch tweets from all configured X accounts.
 */
async function fetchXPosts(xAccounts, apifyToken, maxPerAccount = 50, daysBack = 7) {
  if (!apifyToken) {
    console.log("  [SKIP] No Apify API key configured. Skipping X/Twitter scraping.");
    return [];
  }
  if (!xAccounts || xAccounts.length === 0) {
    console.log("  [SKIP] No X accounts configured. Skipping X/Twitter scraping.");
    return [];
  }

  const allTweets = [];
  for (const account of xAccounts) {
    const handle = account.handle || account;
    try {
      const tweets = await scrapeAccount(handle, apifyToken, maxPerAccount, daysBack);
      allTweets.push(...tweets);
    } catch (err) {
      console.log(`    [ERROR] Failed to scrape ${handle}: ${err.message}`);
    }
  }

  return allTweets;
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

// ─── HTTP Helpers ─────────────────────────────────────────────

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
    req.setTimeout(180000, () => {
      req.destroy();
      reject(new Error("Apify request timed out after 180s"));
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
