/**
 * Stock News Fetcher Module
 * -------------------------
 * What this does (in plain English):
 *   1. Takes a list of stock ticker symbols (like ODFL, KNX) from config.
 *   2. For each ticker, fetches recent news from Yahoo Finance's free RSS feed.
 *   3. Filters to only include news from the last 7 days.
 *   4. Returns an array of news items with ticker, headline, summary, and link.
 *
 * Uses Yahoo Finance RSS feeds — completely free, no API key needed.
 */

const https = require("https");
const { parseString } = require("xml2js");

/**
 * Make an HTTPS GET request and return the body as a string.
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return httpsGet(res.headers.location).then(resolve).catch(reject);
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
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
 * Fetch news for a single ticker from Yahoo Finance RSS.
 */
async function fetchTickerNews(ticker, days = 7) {
  const items = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  // Yahoo Finance RSS feed for a ticker
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;

  try {
    const xmlText = await httpsGet(url);
    const parsed = await parseXml(xmlText);

    let rssItems = parsed?.rss?.channel?.item || [];
    if (!Array.isArray(rssItems)) rssItems = [rssItems];

    for (const item of rssItems) {
      const pubDate = item.pubDate ? new Date(item.pubDate) : null;
      if (pubDate && pubDate < cutoff) continue;

      const formattedDate = pubDate
        ? pubDate.toISOString().split("T")[0]
        : "unknown date";

      items.push({
        ticker: ticker,
        title: item.title || "No title",
        summary: stripHtml(item.description || ""),
        link: item.link || "",
        published: formattedDate,
      });
    }
  } catch (err) {
    // Yahoo RSS might not work for all tickers — try scraping as backup
    try {
      await fetchTickerNewsFromPage(ticker, days, items, cutoff);
    } catch {
      console.log(
        `    [WARNING] Could not fetch news for ${ticker}: ${err.message}`
      );
    }
  }

  return items;
}

/**
 * Fallback: scrape Yahoo Finance quote page for news headlines.
 */
async function fetchTickerNewsFromPage(ticker, days, items, cutoff) {
  const url = `https://finance.yahoo.com/quote/${ticker}/`;
  const html = await httpsGet(url);

  // Extract JSON data embedded in the page
  const match = html.match(
    /root\.App\.main\s*=\s*({.*?});\s*\n/s
  );
  if (!match) return;

  try {
    const data = JSON.parse(match[1]);
    const streams =
      data?.context?.dispatcher?.stores?.StreamStore?.streams || {};
    for (const key of Object.keys(streams)) {
      const stream = streams[key]?.data?.stream_items || [];
      for (const si of stream) {
        if (si.title) {
          items.push({
            ticker: ticker,
            title: si.title,
            summary: si.summary || "",
            link: si.url || "",
            published: "recent",
          });
        }
      }
    }
  } catch {
    // Silently fail — RSS was already attempted
  }
}

/**
 * Main function called by the orchestrator.
 * tickers: array of ticker symbol strings from config.json
 * Returns: array of news item objects.
 */
async function fetchStockNews(tickers, days = 7) {
  const allNews = [];

  for (const ticker of tickers) {
    console.log(`  Fetching news for ${ticker}...`);
    const items = await fetchTickerNews(ticker, days);
    console.log(`    Found ${items.length} recent article(s).`);
    allNews.push(...items);
  }

  return allNews;
}

module.exports = { fetchStockNews };
