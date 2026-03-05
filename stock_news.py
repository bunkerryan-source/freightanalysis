"""
Stock News Fetcher Module
-------------------------
What this does (in plain English):
  1. Takes a list of stock ticker symbols (like ODFL, KNX, etc.) from config.
  2. For each ticker, uses the free yfinance library to pull:
     - The company name
     - Recent news headlines and summaries from Yahoo Finance
  3. Filters to only include news from the last 7 days.
  4. Returns a list of news items with ticker, headline, summary, and link.
"""

import datetime
import yfinance as yf


def fetch_stock_news(tickers, days=7):
    """
    Main function called by the orchestrator.
    tickers: list of ticker symbol strings (from config.yaml)
    Returns: list of news item dicts.
    """
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
    all_news = []

    for ticker_symbol in tickers:
        print(f"  Fetching news for {ticker_symbol}...")
        try:
            ticker = yf.Ticker(ticker_symbol)
            news_items = ticker.news or []

            count = 0
            for item in news_items:
                # yfinance news items have 'providerPublishTime' (unix timestamp)
                pub_time = item.get("providerPublishTime")
                if pub_time:
                    pub_dt = datetime.datetime.fromtimestamp(pub_time, tz=datetime.timezone.utc)
                    if pub_dt < cutoff:
                        continue
                    pub_str = pub_dt.strftime("%Y-%m-%d")
                else:
                    pub_str = "unknown date"

                # Extract content from the nested structure if present
                title = item.get("title", "No title")
                link = item.get("link", "")

                # yfinance may nest content under 'content' key in newer versions
                if "content" in item and isinstance(item["content"], dict):
                    content = item["content"]
                    title = content.get("title", title)
                    link = content.get("canonicalUrl", {}).get("url", link)
                    pub_str = content.get("pubDate", pub_str)

                summary = item.get("summary", item.get("description", ""))

                all_news.append({
                    "ticker": ticker_symbol,
                    "title": title,
                    "summary": summary,
                    "link": link,
                    "published": pub_str,
                })
                count += 1

            print(f"    Found {count} recent article(s).")

        except Exception as e:
            print(f"    [WARNING] Could not fetch news for {ticker_symbol}: {e}")

    return all_news
