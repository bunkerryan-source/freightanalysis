/**
 * Freight Market Summary Tool - Main Orchestrator
 * ================================================
 * What this does (in plain English):
 *   This is the main script you run each week. It:
 *   1. Reads your config file (config.json) for channels, feeds, tickers, and keys.
 *   2. Pulls YouTube videos and transcripts from the last 7 days.
 *   3. Pulls podcast episodes and show notes from the last 7 days.
 *   4. Pulls stock news for freight/trucking companies.
 *   5. Scrapes X/Twitter posts from configured accounts via Apify.
 *   6. Sends everything to the Claude AI API to generate a structured weekly report.
 *   7. Saves the report as a markdown file with today's date.
 *   8. Prints the report to your screen.
 *   9. Emails the report to you via SendGrid.
 *
 * How to run it:
 *   node freight_summary.js
 */

const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

// Load .env file if it exists (keeps API keys out of git)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const { fetchYoutubeData } = require("./youtube_scraper");
const { fetchPodcastData } = require("./podcast_scraper");
const { fetchStockNews } = require("./stock_news");
const { fetchXPosts, downloadTweetImages, filterChartImages, cleanupTempImages } = require("./x_scraper");

// ─── Helpers ────────────────────────────────────────────────

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  if (!fs.existsSync(configPath)) {
    console.error("  [ERROR] config.json not found!");
    console.error("  Make sure config.json is in the same folder as this script.");
    process.exit(1);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw);

  // Environment variables override config.json placeholders
  if (process.env.ANTHROPIC_API_KEY) {
    config.api_keys.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.OPENAI_API_KEY) {
    config.api_keys.openai_api_key = process.env.OPENAI_API_KEY;
  }
  if (process.env.SENDGRID_API_KEY) {
    config.api_keys.sendgrid_api_key = process.env.SENDGRID_API_KEY;
  }
  if (process.env.APIFY_API_KEY) {
    config.api_keys.apify_api_key = process.env.APIFY_API_KEY;
  }

  return config;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── (Manual Twitter input removed — now uses Apify scraper) ──

// ─── Prompt Builder ─────────────────────────────────────────

function buildPrompt(youtubeData, podcastData, stockData, xPosts) {
  const today = formatDate(new Date());
  const weekAgo = formatDate(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  // Budget: ~400K chars total for all content (~100K tokens, well within context)
  // Reserve space for stock data, twitter, and prompt instructions (~20K chars)
  const TOTAL_CONTENT_BUDGET = 380000;
  const totalSources = youtubeData.length + podcastData.length;
  const perSourceLimit = totalSources > 0
    ? Math.floor(TOTAL_CONTENT_BUDGET / totalSources)
    : 30000;

  console.log(`  [INFO] ${totalSources} total sources, ~${Math.round(perSourceLimit / 1000)}K chars per source.`);

  let prompt = `You are a freight and trucking industry analyst. Based on the data below,
generate a comprehensive weekly freight market summary for the week of ${weekAgo} to ${today}.

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
- Reference specific details, quotes, data points, and analysis from the transcripts — do NOT just list titles.
- If data is thin in any area, note that and still provide useful analysis based on what's available.
- For the Public Company Highlights section, organize by ticker symbol.
- Keep the total report between 2000-4000 words.

---

### YOUTUBE VIDEO DATA
`;

  if (youtubeData.length > 0) {
    for (const v of youtubeData) {
      prompt += `\n**Channel:** ${v.channel_name}\n`;
      prompt += `**Title:** ${v.title}\n`;
      prompt += `**Published:** ${v.published}\n`;
      prompt += `**URL:** ${v.url}\n`;
      if (v.transcript) {
        const transcript = v.transcript.substring(0, perSourceLimit);
        prompt += `**Transcript:** ${transcript}\n`;
      } else if (v.description) {
        prompt += `**Transcript:** [Unavailable — using video description]\n`;
        prompt += `**Description:** ${v.description.substring(0, 5000)}\n`;
      } else {
        prompt += `**Transcript:** [Unavailable]\n`;
      }
      prompt += "\n---\n";
    }
  } else {
    prompt += "\n[No YouTube videos found for this period.]\n";
  }

  prompt += "\n\n### PODCAST EPISODE DATA\n";

  if (podcastData.length > 0) {
    for (const ep of podcastData) {
      prompt += `\n**Podcast:** ${ep.podcast_name}\n`;
      prompt += `**Title:** ${ep.title}\n`;
      prompt += `**Published:** ${ep.published}\n`;
      prompt += `**Content Method:** ${ep.transcript_method}\n`;
      if (ep.transcript) {
        const transcript = ep.transcript.substring(0, perSourceLimit);
        prompt += `**Content:** ${transcript}\n`;
      }
      prompt += "\n---\n";
    }
  } else {
    prompt += "\n[No podcast episodes found for this period.]\n";
  }

  prompt += "\n\n### STOCK NEWS DATA\n";

  if (stockData.length > 0) {
    for (const item of stockData) {
      prompt += `\n**Ticker:** ${item.ticker}\n`;
      prompt += `**Headline:** ${item.title}\n`;
      prompt += `**Published:** ${item.published}\n`;
      if (item.summary) {
        prompt += `**Summary:** ${item.summary}\n`;
      }
      prompt += "\n---\n";
    }
  } else {
    prompt += "\n[No stock news found for this period.]\n";
  }

  prompt += "\n\n### X/TWITTER POSTS\n";

  if (xPosts && xPosts.length > 0) {
    for (const post of xPosts) {
      prompt += `\n**Author:** ${post.authorHandle}\n`;
      prompt += `**Date:** ${post.date}\n`;
      prompt += `**Post:** ${post.text}\n`;
      if (post.imageUrls && post.imageUrls.length > 0) {
        prompt += `**Attached Images:** ${post.imageUrls.length} image(s)\n`;
      }
      prompt += "\n---\n";
    }
  } else {
    prompt += "\n[No X/Twitter posts found for this period.]\n";
  }

  console.log(`  [INFO] Total prompt size: ${Math.round(prompt.length / 1000)}K chars (~${Math.round(prompt.length / 4000)}K tokens).`);

  return prompt;
}

// ─── Claude AI Report Generation ────────────────────────────

async function generateReport(prompt, apiKey, model, chartImages) {
  console.log("\n  Sending data to Claude API for synthesis...");

  const client = new Anthropic({ apiKey: apiKey });
  const today = formatDate(new Date());

  // Build multimodal content: text prompt + any chart images
  const contentBlocks = [];

  if (chartImages && chartImages.length > 0) {
    contentBlocks.push({
      type: "text",
      text: `The following ${chartImages.length} chart/data image(s) were attached to X/Twitter posts from freight industry accounts. Analyze what you see in these charts and incorporate the data and trends into the weekly report.\n`,
    });

    for (const img of chartImages) {
      try {
        const imageData = fs.readFileSync(img.localPath);
        const base64 = imageData.toString("base64");
        const ext = path.extname(img.localPath).toLowerCase().replace(".", "");
        const mediaType = ext === "png" ? "image/png"
          : ext === "gif" ? "image/gif"
          : ext === "webp" ? "image/webp"
          : "image/jpeg";

        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      } catch (err) {
        console.log(`  [WARN] Could not read chart image ${img.localPath}: ${err.message}`);
      }
    }
  }

  contentBlocks.push({ type: "text", text: prompt });

  const message = await client.messages.create({
    model: model,
    max_tokens: 8192,
    system: `You are a freight and trucking industry analyst producing a weekly market summary report dated ${today}. Write in markdown format.`,
    messages: [{ role: "user", content: contentBlocks }],
  });

  let reportText = "";
  for (const block of message.content) {
    if (block.type === "text") {
      reportText += block.text;
    }
  }

  return reportText;
}

// ─── Save Report ────────────────────────────────────────────

function saveReport(reportText) {
  const today = todayStr();
  const filename = `freight_summary_${today}.md`;
  const filepath = path.join(__dirname, filename);

  const content = `# Weekly Freight Market Summary\n**Week ending ${today}**\n\n${reportText}`;
  fs.writeFileSync(filepath, content, "utf-8");

  return filepath;
}

// ─── Email via SendGrid ─────────────────────────────────────

async function sendEmail(reportText, filepath, config) {
  const sgApiKey = config.api_keys.sendgrid_api_key;
  if (!sgApiKey || sgApiKey === "YOUR_SENDGRID_API_KEY_HERE") {
    console.log("\n  [SKIP] SendGrid API key not configured. Skipping email.");
    console.log("  To enable email, add your SendGrid API key to config.json.");
    return false;
  }

  const emailConfig = config.email || {};
  const fromEmail = emailConfig.from_email || "freight-summary@example.com";
  const toEmail = emailConfig.to_email || "you@example.com";
  const subjectPrefix =
    emailConfig.subject_prefix || "Weekly Freight Market Summary";
  const today = todayStr();

  try {
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(sgApiKey);

    // Basic markdown-to-HTML conversion for email body
    let html = reportText;
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\n\n/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");
    html = `<div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;"><p>${html}</p></div>`;

    const fileContent = fs.readFileSync(filepath, "utf-8");
    const encoded = Buffer.from(fileContent).toString("base64");

    const msg = {
      to: toEmail,
      from: fromEmail,
      subject: `${subjectPrefix} - ${today}`,
      html: html,
      attachments: [
        {
          content: encoded,
          filename: path.basename(filepath),
          type: "text/markdown",
          disposition: "attachment",
        },
      ],
    };

    const response = await sgMail.send(msg);
    console.log(
      `\n  [OK] Email sent! Status code: ${response[0].statusCode}`
    );
    return true;
  } catch (err) {
    console.log(`\n  [ERROR] Failed to send email: ${err.message}`);
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  WEEKLY FREIGHT MARKET SUMMARY TOOL");
  console.log("=".repeat(60));
  console.log("");

  // Step 1: Load config
  console.log("[1/9] Loading configuration...");
  const config = loadConfig();

  const apiKey = config.api_keys?.anthropic_api_key;
  if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
    console.error("  [ERROR] Anthropic API key not set in config.json!");
    console.error("  Get your key at: https://console.anthropic.com/");
    process.exit(1);
  }
  console.log("  [OK] Config loaded.\n");

  // Step 2: YouTube
  console.log("[2/9] Fetching YouTube data...");
  const youtubeChannels = config.youtube_channels || [];
  const youtubeData = await fetchYoutubeData(youtubeChannels);
  console.log(`  Total: ${youtubeData.length} video(s) collected.\n`);

  // Step 3: Podcasts
  console.log("[3/9] Fetching podcast data...");
  const podcastFeeds = config.podcast_feeds || [];
  const openaiKey = config.api_keys?.openai_api_key;
  const hasOpenaiKey = openaiKey && openaiKey !== "YOUR_OPENAI_API_KEY_HERE";
  if (hasOpenaiKey) {
    console.log("  [OK] OpenAI API key found — Whisper transcription enabled.");
  } else {
    console.log("  [INFO] No OpenAI API key — podcast audio transcription disabled.");
    console.log("  To enable, add your OpenAI API key to config.json.");
  }
  const podcastData = await fetchPodcastData(podcastFeeds, 7, hasOpenaiKey ? openaiKey : null);
  console.log(`  Total: ${podcastData.length} episode(s) collected.\n`);

  // Step 4: Stock news
  console.log("[4/9] Fetching stock news...");
  const tickers = config.stock_tickers || [];
  const stockData = await fetchStockNews(tickers);
  console.log(`  Total: ${stockData.length} news item(s) collected.\n`);

  // Step 5: Scrape X/Twitter posts via Apify
  console.log("[5/9] Scraping X/Twitter posts via Apify...");
  const xAccounts = config.x_accounts || [];
  const apifyKey = config.api_keys?.apify_api_key;
  const hasApifyKey = apifyKey && apifyKey !== "YOUR_APIFY_API_KEY_HERE";
  if (!hasApifyKey) {
    console.log("  [INFO] No Apify API key — X/Twitter scraping disabled.");
    console.log("  To enable, add your Apify API key to .env or config.json.");
  }
  const xPosts = await fetchXPosts(xAccounts, hasApifyKey ? apifyKey : null);
  console.log(`  Total: ${xPosts.length} X post(s) collected.\n`);

  // Step 6: Download and classify tweet images
  console.log("[6/9] Processing X/Twitter images...");
  const claudeModel = config.claude_model || "claude-opus-4-20250918";
  let chartImages = [];
  const downloadedImages = await downloadTweetImages(xPosts);
  if (downloadedImages.length > 0) {
    chartImages = await filterChartImages(downloadedImages, apiKey, claudeModel);
  } else {
    console.log("  [INFO] No images to process.");
  }

  // Step 7: Generate report with Claude
  console.log("\n[7/9] Generating report with Claude AI...");
  const prompt = buildPrompt(youtubeData, podcastData, stockData, xPosts);
  console.log(`  Using model: ${claudeModel}`);
  const report = await generateReport(prompt, apiKey, claudeModel, chartImages);

  // Step 8: Save and output
  console.log("\n[8/9] Saving and delivering report...");
  const filepath = saveReport(report);
  console.log(`  [OK] Report saved to: ${filepath}`);

  // Print to screen
  console.log("");
  console.log("=".repeat(60));
  console.log("  WEEKLY FREIGHT MARKET SUMMARY");
  console.log("=".repeat(60));
  console.log("");
  console.log(report);
  console.log("");
  console.log("=".repeat(60));

  // Send email
  await sendEmail(report, filepath, config);

  // Step 9: Clean up temp images
  console.log("\n[9/9] Cleaning up...");
  cleanupTempImages();

  console.log("");
  console.log("  Done! Your weekly freight summary is ready.");
  console.log(`  File: ${filepath}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n[FATAL ERROR]", err.message);
  console.error(
    "If this is an API error, check that your API key is correct in config.json."
  );
  process.exit(1);
});
