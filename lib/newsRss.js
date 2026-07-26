async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'InvestorAI/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  return res.text();
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pick(tag, block) {
  const cdata = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'));
  if (cdata) return decodeXml(cdata[1]).trim();
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml((plain && plain[1]) || '').trim();
}

function pickAttr(tag, attr, block) {
  const m = block.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*/?>`, 'i'));
  return m ? m[1] : null;
}

function toAvStamp(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function newsTimeMs(item) {
  if (item.publishedAt) return item.publishedAt;
  if (!item.time) return 0;
  const raw = item.time;
  if (/^\d{8}T\d{6}/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => newsTimeMs(b) - newsTimeMs(a));
}

function parseRss(xml, source) {
  const items = [];
  const parts = xml.split(/<item[\s>]/i).slice(1);
  for (const part of parts.slice(0, 20)) {
    const title = pick('title', part);
    const link = pick('link', part);
    if (!title || !link) continue;
    const description = pick('description', part).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const pubDate = pick('pubDate', part);
    const publishedAt = pubDate ? new Date(pubDate).getTime() : 0;
    const image =
      pickAttr('media:content', 'url', part) ||
      pickAttr('media:thumbnail', 'url', part) ||
      pickAttr('enclosure', 'url', part) ||
      null;

    items.push({
      id: link,
      title,
      summary: description.slice(0, 220),
      source,
      url: link,
      time: toAvStamp(pubDate),
      publishedAt: Number.isNaN(publishedAt) ? 0 : publishedAt,
      image,
      sentiment: null,
      tickers: [],
      primaryTicker: null,
    });
  }
  return items;
}

export async function getMarketNewsRss() {
  return getNewsByTopic('top');
}

/** Teemad News UI jaoks — RSS + valikuline märksõnafilter. */
export const NEWS_TOPICS = [
  {
    id: 'top',
    label: 'Top',
    feeds: [
      { url: 'https://finance.yahoo.com/rss/topstories', source: 'Yahoo Finance' },
      { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
      { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch' },
    ],
  },
  {
    id: 'markets',
    label: 'Markets',
    feeds: [
      { url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Markets' },
      { url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/', source: 'MarketWatch' },
      { url: 'https://finance.yahoo.com/rss/topstories', source: 'Yahoo Finance' },
    ],
    keywords: ['market', 'stocks', 'dow', 's&p', 'nasdaq', 'wall street', 'rally', 'selloff', 'indexes'],
  },
  {
    id: 'tech',
    label: 'Tech',
    feeds: [
      { url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', source: 'CNBC Tech' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,GOOGL,META,AMZN&region=US&lang=en-US', source: 'Yahoo Tech' },
    ],
    keywords: ['tech', 'apple', 'microsoft', 'google', 'meta', 'amazon', 'software', 'cloud'],
  },
  {
    id: 'ai',
    label: 'AI',
    feeds: [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,MSFT,GOOGL,AMD,PLTR&region=US&lang=en-US', source: 'Yahoo AI' },
      { url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', source: 'CNBC Tech' },
    ],
    keywords: ['ai', 'artificial intelligence', 'openai', 'chatgpt', 'llm', 'gpu', 'nvidia'],
  },
  {
    id: 'semis',
    label: 'Semiconductors',
    feeds: [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=NVDA,AMD,AVGO,TSM,SMH,MU,INTC,ASML&region=US&lang=en-US', source: 'Yahoo Semis' },
    ],
    keywords: ['chip', 'semiconductor', 'nvidia', 'tsmc', 'foundry', 'gpu', 'memory'],
  },
  {
    id: 'etf',
    label: 'ETF / Fondid',
    feeds: [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,QQQ,VOO,IWM,SMH,XLK&region=US&lang=en-US', source: 'Yahoo ETF' },
      { url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html', source: 'CNBC Investing' },
    ],
    keywords: ['etf', 'fund', 'index', 'vanguard', 'blackrock', 'invesco'],
  },
  {
    id: 'earnings',
    label: 'Earnings',
    feeds: [
      { url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC' },
      { url: 'https://feeds.marketwatch.com/marketwatch/marketpulse/', source: 'MarketWatch' },
    ],
    keywords: ['earnings', 'results', 'revenue', 'eps', 'guidance', 'quarter', 'profit'],
  },
  {
    id: 'economy',
    label: 'Economy / Fed',
    feeds: [
      { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'CNBC Economy' },
      { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch' },
    ],
    keywords: ['fed', 'inflation', 'rates', 'gdp', 'jobs', 'cpi', 'powell', 'economy', 'recession'],
  },
  {
    id: 'energy',
    label: 'Energy',
    feeds: [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=XOM,CVX,COP,XLE,USO&region=US&lang=en-US', source: 'Yahoo Energy' },
      { url: 'https://www.cnbc.com/id/19836768/device/rss/rss.html', source: 'CNBC Energy' },
    ],
    keywords: ['oil', 'energy', 'gas', 'opec', 'crude', 'renewable'],
  },
  {
    id: 'crypto',
    label: 'Crypto',
    feeds: [
      { url: 'https://www.cnbc.com/id/100733567/device/rss/rss.html', source: 'CNBC Crypto' },
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD,ETH-USD,COIN,MSTR&region=US&lang=en-US', source: 'Yahoo Crypto' },
    ],
    keywords: ['bitcoin', 'crypto', 'ethereum', 'btc', 'blockchain', 'coinbase'],
  },
  {
    id: 'europe',
    label: 'Europe',
    feeds: [
      { url: 'https://www.cnbc.com/id/19794221/device/rss/rss.html', source: 'CNBC Europe' },
      { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch' },
    ],
    keywords: ['europe', 'ecb', 'euro', 'germany', 'uk', 'london', 'stoxx'],
  },
  {
    id: 'banking',
    label: 'Banks',
    feeds: [
      { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=JPM,BAC,WFC,C,GS,MS&region=US&lang=en-US', source: 'Yahoo Banks' },
      { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC Finance' },
    ],
    keywords: ['bank', 'banking', 'jpmorgan', 'fed', 'loan', 'credit'],
  },
];

function scoreByKeywords(item, keywords = []) {
  if (!keywords.length) return 0;
  const hay = `${item.title} ${item.summary}`.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (hay.includes(kw.toLowerCase())) score += 1;
  }
  return score;
}

async function fetchFeeds(feeds) {
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const xml = await fetchText(f.url);
      return parseRss(xml, f.source);
    })
  );

  const merged = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

export async function getNewsByTopic(topicId = 'top') {
  const topic = NEWS_TOPICS.find((t) => t.id === topicId) || NEWS_TOPICS[0];
  let items = await fetchFeeds(topic.feeds);

  // Kui teema-RSS nõrk, sega top-uudistega ja filtreeri märksõnadega
  if (items.length < 6 && topic.id !== 'top') {
    const top = await fetchFeeds(NEWS_TOPICS[0].feeds);
    const seen = new Set(items.map((i) => i.url));
    for (const item of top) {
      if (seen.has(item.url)) continue;
      items.push(item);
      seen.add(item.url);
    }
  }

  if (topic.keywords?.length) {
    items = [...items].sort((a, b) => {
      const sb = scoreByKeywords(b, topic.keywords) - scoreByKeywords(a, topic.keywords);
      if (sb !== 0) return sb;
      return newsTimeMs(b) - newsTimeMs(a);
    });
    // Eelista märksõnaga hitte, aga jäta ka värskeid pealkirju
    const matched = items.filter((i) => scoreByKeywords(i, topic.keywords) > 0);
    const rest = items.filter((i) => scoreByKeywords(i, topic.keywords) === 0);
    items = [...matched, ...rest];
  } else {
    items = sortNewestFirst(items);
  }

  if (items.length === 0) {
    throw new Error('Uudiste RSS-e ei õnnestunud laadida');
  }

  return {
    topic: topic.id,
    label: topic.label,
    items: items.slice(0, 24),
  };
}

/** Uudised konkreetsete trendi-sümbolite kohta (Yahoo RSS). */
export async function getTrendNews(symbols = []) {
  const unique = [...new Set(symbols.filter(Boolean).map((s) => String(s).toUpperCase()))].slice(0, 5);
  if (unique.length === 0) return { items: [] };

  const results = await Promise.allSettled(
    unique.map(async (symbol) => {
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
      const xml = await fetchText(url);
      return parseRss(xml, `${symbol} · Yahoo`).map((item) => ({
        ...item,
        relatedSymbol: symbol,
        tickers: [{ symbol, score: 0 }],
      }));
    })
  );

  const merged = [];
  const seen = new Set();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const item of r.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }

  return { items: sortNewestFirst(merged).slice(0, 20) };
}
