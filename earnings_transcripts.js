/**
 * Earnings Call Transcript Fetcher Module
 * ----------------------------------------
 * What this does (in plain English):
 *   1. Takes a list of stock ticker symbols from config.
 *   2. For each ticker, fetches recent earnings call transcripts from Financial Modeling Prep API.
 *   3. Filters to only include transcripts from the last 7 days.
 *   4. Returns an array of transcript objects with ticker, date, quarter, year, and content.
 *
 * Uses Financial Modeling Prep (FMP) API — requires a free or paid API key.
 * Get your key at: https://financialmodelingprep.com/developer/docs/
 */

const https = require("https");

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
 * Fetch earnings call transcripts for a single ticker from FMP API.
 * Returns transcripts from the last `days` days, or empty array if none found.
 */
async function fetchTickerTranscripts(ticker, apiKey, days = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const now = new Date();
  const year = now.getFullYear();

  // Determine which quarters to check based on current date
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
  const quartersToCheck = [];
  // Check current and previous quarter (transcripts may be released in the following quarter)
  quartersToCheck.push({ year, quarter: currentQuarter });
  if (currentQuarter > 1) {
    quartersToCheck.push({ year, quarter: currentQuarter - 1 });
  } else {
    quartersToCheck.push({ year: year - 1, quarter: 4 });
  }

  const transcripts = [];

  for (const { year: y, quarter: q } of quartersToCheck) {
    const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${ticker}?year=${y}&quarter=${q}&apikey=${apiKey}`;

    try {
      const response = await httpsGet(url);
      const data = JSON.parse(response);

      if (!Array.isArray(data) || data.length === 0) continue;

      for (const item of data) {
        const transcriptDate = item.date ? new Date(item.date) : null;
        if (!transcriptDate || transcriptDate < cutoff) continue;

        transcripts.push({
          ticker: item.symbol || ticker,
          date: transcriptDate.toISOString().split("T")[0],
          quarter: item.quarter || q,
          year: item.year || y,
          content: item.content || "",
        });
      }
    } catch (err) {
      // Silently continue — will log at the caller level
    }
  }

  return transcripts;
}

/**
 * Main function called by the orchestrator.
 * tickers: array of ticker symbol strings from config.json
 * apiKey: Financial Modeling Prep API key
 * days: number of days to look back (default 7)
 * Returns: array of transcript objects.
 */
async function fetchEarningsTranscripts(tickers, apiKey, days = 7) {
  if (!apiKey) {
    console.log("  [SKIP] No FMP API key configured. Skipping earnings transcripts.");
    return [];
  }

  const allTranscripts = [];

  for (const ticker of tickers) {
    console.log(`  Checking earnings transcripts for ${ticker}...`);
    const items = await fetchTickerTranscripts(ticker, apiKey, days);
    if (items.length > 0) {
      console.log(`    Found ${items.length} recent transcript(s).`);
      allTranscripts.push(...items);
    } else {
      console.log(`    No recent transcripts.`);
    }
  }

  return allTranscripts;
}

module.exports = { fetchEarningsTranscripts };
