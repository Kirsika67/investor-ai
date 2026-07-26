import dns from 'dns';
import { cached } from './cache';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // ignore
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const RANGES = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '30m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '6M': { range: '6mo', interval: '1d' },
  YTD: { range: 'ytd', interval: '1d' },
  '1Y': { range: '1y', interval: '1d' },
  '2Y': { range: '2y', interval: '1wk' },
  '5Y': { range: '5y', interval: '1wk' },
  '10Y': { range: '10y', interval: '1mo' },
  ALL: { range: 'max', interval: '1mo' },
};

let crumbSession = { crumb: null, cookie: '', at: 0 };

function collectCookies(res, prev = '') {
  const jar = new Map();
  for (const part of prev.split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1));
  }
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const line of raw) {
    const first = String(line).split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function ensureCrumb(force = false) {
  if (!force && crumbSession.crumb && Date.now() - crumbSession.at < 45 * 60 * 1000) {
    return crumbSession;
  }

  let cookie = '';
  const boot = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  cookie = collectCookies(boot, cookie);

  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain' },
  });
  cookie = collectCookies(crumbRes, cookie);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 80 || crumb.includes('<')) {
    throw new Error('Yahoo crumb ebaõnnestus');
  }

  crumbSession = { crumb, cookie, at: Date.now() };
  return crumbSession;
}

async function yahooJson(url, { withCrumb = false } = {}) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (withCrumb) {
    const session = await ensureCrumb();
    headers.Cookie = session.cookie;
    const join = url.includes('?') ? '&' : '?';
    url = `${url}${join}crumb=${encodeURIComponent(session.crumb)}`;
  }

  let res = await fetch(url, { headers, cache: 'no-store' });
  if (withCrumb && res.status === 401) {
    await ensureCrumb(true);
    const session = await ensureCrumb();
    headers.Cookie = session.cookie;
    const base = url.replace(/([?&])crumb=[^&]*/, '').replace(/[?&]$/, '');
    const join = base.includes('?') ? '&' : '?';
    res = await fetch(`${base}${join}crumb=${encodeURIComponent(session.crumb)}`, {
      headers,
      cache: 'no-store',
    });
  }
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  return res.json();
}

function pickCloses(result) {
  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    points.push({ t: ts[i] * 1000, price: c });
  }
  return points;
}

function raw(obj, key) {
  const v = obj?.[key];
  if (v == null) return null;
  if (typeof v === 'object' && 'raw' in v) return v.raw;
  if (typeof v === 'number') return v;
  return null;
}

export async function getFundamentals(symbol) {
  const upper = String(symbol).toUpperCase();
  return cached(`fund:v2:${upper}`, 10 * 60 * 1000, async () => {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(upper)}?modules=summaryDetail,defaultKeyStatistics,price,financialData,summaryProfile`;
    const data = await yahooJson(url, { withCrumb: true });
    const block = data?.quoteSummary?.result?.[0];
    if (!block) throw new Error(data?.quoteSummary?.error?.description || 'Fundamentals puuduvad');

    const sd = block.summaryDetail || {};
    const ks = block.defaultKeyStatistics || {};
    const price = block.price || {};
    const fd = block.financialData || {};
    const sp = block.summaryProfile || {};

    return {
      open: raw(price, 'regularMarketOpen') ?? raw(sd, 'open'),
      high: raw(price, 'regularMarketDayHigh') ?? raw(sd, 'dayHigh'),
      low: raw(price, 'regularMarketDayLow') ?? raw(sd, 'dayLow'),
      volume: raw(price, 'regularMarketVolume') ?? raw(sd, 'volume'),
      pe: raw(sd, 'trailingPE') ?? raw(ks, 'trailingPE'),
      forwardPE: raw(sd, 'forwardPE') ?? raw(ks, 'forwardPE'),
      pegRatio: raw(ks, 'pegRatio') ?? raw(ks, 'pegRatios'),
      priceToBook: raw(ks, 'priceToBook') ?? raw(sd, 'priceToBook'),
      bookValue: raw(ks, 'bookValue'),
      profitMargins: raw(fd, 'profitMargins') ?? raw(ks, 'profitMargins'),
      revenueGrowth: raw(fd, 'revenueGrowth'),
      earningsGrowth: raw(fd, 'earningsGrowth') ?? raw(fd, 'earningsQuarterlyGrowth'),
      sector: sp.sector || null,
      industry: sp.industry || null,
      quoteType: price.quoteType || null,
      marketCap: raw(price, 'marketCap') ?? raw(sd, 'marketCap'),
      fiftyTwoWeekHigh: raw(sd, 'fiftyTwoWeekHigh') ?? raw(ks, 'fiftyTwoWeekHigh'),
      fiftyTwoWeekLow: raw(sd, 'fiftyTwoWeekLow') ?? raw(ks, 'fiftyTwoWeekLow'),
      avgVolume: raw(sd, 'averageVolume') ?? raw(sd, 'averageDailyVolume10Day'),
      yield: raw(sd, 'dividendYield') ?? raw(sd, 'yield'),
      beta: raw(sd, 'beta') ?? raw(ks, 'beta'),
      eps: raw(ks, 'trailingEps') ?? raw(sd, 'trailingEps'),
      previousClose: raw(price, 'regularMarketPreviousClose') ?? raw(sd, 'previousClose'),
    };
  });
}

export async function getChart(symbol, rangeKey = '1D') {
  const cfg = RANGES[rangeKey] || RANGES['1D'];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${cfg.range}&interval=${cfg.interval}&includePrePost=true`;
  const data = await yahooJson(url);
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'Sümbolit ei leitud');

  const m = result.meta || {};
  const points = pickCloses(result);
  const price = m.regularMarketPrice ?? points[points.length - 1]?.price;
  // Yahoo UI daily % uses previousClose (eelmise sessiooni sulgemine),
  // NOT chartPreviousClose (mis multi-day chartil on range algus).
  const prev = m.previousClose ?? m.chartPreviousClose;
  const change = prev != null && price != null ? price - prev : null;
  const changePercent = prev ? (change / prev) * 100 : null;

  let fundamentals = {};
  try {
    fundamentals = await getFundamentals(symbol);
  } catch {
    // chart alone still works
  }

  return {
    symbol: m.symbol || symbol.toUpperCase(),
    name: m.longName || m.shortName || symbol.toUpperCase(),
    shortName: m.shortName || m.symbol,
    exchange: m.fullExchangeName || m.exchangeName || '',
    currency: m.currency || 'USD',
    price,
    previousClose: fundamentals.previousClose ?? prev,
    change,
    changePercent,
    open: fundamentals.open ?? m.regularMarketOpen ?? null,
    high: fundamentals.high ?? m.regularMarketDayHigh ?? null,
    low: fundamentals.low ?? m.regularMarketDayLow ?? null,
    volume: fundamentals.volume ?? m.regularMarketVolume ?? null,
    pe: fundamentals.pe ?? null,
    forwardPE: fundamentals.forwardPE ?? null,
    pegRatio: fundamentals.pegRatio ?? null,
    priceToBook: fundamentals.priceToBook ?? null,
    bookValue: fundamentals.bookValue ?? null,
    profitMargins: fundamentals.profitMargins ?? null,
    revenueGrowth: fundamentals.revenueGrowth ?? null,
    earningsGrowth: fundamentals.earningsGrowth ?? null,
    sector: fundamentals.sector ?? null,
    industry: fundamentals.industry ?? null,
    quoteType: fundamentals.quoteType ?? m.instrumentType ?? null,
    marketCap: fundamentals.marketCap ?? null,
    fiftyTwoWeekHigh: fundamentals.fiftyTwoWeekHigh ?? m.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: fundamentals.fiftyTwoWeekLow ?? m.fiftyTwoWeekLow ?? null,
    avgVolume: fundamentals.avgVolume ?? null,
    yield: fundamentals.yield ?? null,
    beta: fundamentals.beta ?? null,
    eps: fundamentals.eps ?? null,
    marketState: m.marketState || null,
    points,
    rangeKey,
    updatedAt: new Date().toISOString(),
  };
}

export async function getQuotes(symbols) {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 40);
  const out = [];
  for (const symbol of unique) {
    try {
      // 1D chart → sama päevane % ja sparkline nagu Yahoo Finance listis
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=true`;
      const data = await yahooJson(url);
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const m = result.meta || {};
      const points = pickCloses(result);
      const spark = points.slice(-48).map((p) => p.price);
      const price = m.regularMarketPrice ?? spark[spark.length - 1] ?? null;
      const prev = m.previousClose ?? m.chartPreviousClose ?? null;
      const change = prev != null && price != null ? price - prev : null;
      const changePercent = prev && price != null ? (change / prev) * 100 : null;
      out.push({
        symbol: m.symbol || symbol,
        name: m.shortName || m.longName || symbol,
        price,
        previousClose: prev,
        change,
        changePercent,
        spark,
        currency: m.currency || 'USD',
        marketState: m.marketState || null,
        updatedAt: new Date().toISOString(),
      });
      await new Promise((r) => setTimeout(r, 220));
    } catch {
      // jätka teiste sümbolitega
    }
  }
  return out;
}

function mapScreenerQuote(q) {
  return {
    symbol: q.symbol,
    name: q.shortName || q.longName || q.symbol,
    price: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent ?? 0,
    volume: q.regularMarketVolume ?? null,
  };
}

async function fetchScreener(scrId, count = 10) {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=${count}&scrIds=${encodeURIComponent(scrId)}&formatted=false`;
  const data = await yahooJson(url);
  const quotes = data?.finance?.result?.[0]?.quotes || [];
  return quotes.filter((q) => q?.symbol).map(mapScreenerQuote);
}

export const TREND_TYPES = [
  { id: 'all', label: 'Kõik' },
  { id: 'up', label: 'Tipptõusjad', title: 'Päeva tipptõusjad', screener: 'day_gainers', kind: 'up' },
  { id: 'down', label: 'Langejad', title: 'Päeva suurimad langejad', screener: 'day_losers', kind: 'down' },
  { id: 'active', label: 'Aktiivseimad', title: 'Kõige aktiivsemad', screener: 'most_actives', kind: 'active' },
  { id: 'growth', label: 'Growth Tech', title: 'Growth technology', screener: 'growth_technology_stocks', kind: 'up' },
  { id: 'value', label: 'Undervalued Growth', title: 'Undervalued growth', screener: 'undervalued_growth_stocks', kind: 'active' },
  { id: 'smallcap', label: 'Small Cap Gainers', title: 'Small cap gainers', screener: 'small_cap_gainers', kind: 'up' },
  { id: 'shorted', label: 'Most Shorted', title: 'Most shorted stocks', screener: 'most_shorted_stocks', kind: 'down' },
  { id: 'news', label: 'Trendiuudised', title: 'Trendiuudised' },
];

/** Yahoo day gainers / losers / most actives — sama allikas mis Yahoo Finance Trends. */
export async function getTopMovers() {
  const [gainers, losers, mostActive] = await Promise.all([
    fetchScreener('day_gainers', 10),
    fetchScreener('day_losers', 10),
    fetchScreener('most_actives', 10),
  ]);
  return {
    lastUpdated: new Date().toISOString(),
    gainers: gainers.slice(0, 8),
    losers: losers.slice(0, 8),
    mostActive: mostActive.slice(0, 8),
    source: 'yahoo',
  };
}

/** Üks trenditüüp Yahoo screenerist. */
export async function getTrendScreener(typeId) {
  const type = TREND_TYPES.find((t) => t.id === typeId && t.screener);
  if (!type) return { type: typeId, items: [], source: 'yahoo' };
  const items = await fetchScreener(type.screener, 12);
  return {
    type: type.id,
    title: type.title || type.label,
    kind: type.kind,
    items: items.slice(0, 10),
    lastUpdated: new Date().toISOString(),
    source: 'yahoo',
  };
}

const POPULAR = [
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', type: 'EQUITY', exchange: 'NASDAQ' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'ETF', exchange: 'NYSEARCA' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'ETF', exchange: 'NASDAQ' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'ETF', exchange: 'NYSEARCA' },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'ETF', exchange: 'NYSEARCA' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway Inc.', type: 'EQUITY', exchange: 'NYSE' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', type: 'EQUITY', exchange: 'NYSE' },
  { symbol: 'DIS', name: 'The Walt Disney Company', type: 'EQUITY', exchange: 'NYSE' },
];

export async function searchSymbols(query) {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();

  const local = POPULAR.filter(
    (p) =>
      p.symbol.toLowerCase().startsWith(lower) ||
      p.name.toLowerCase().startsWith(lower) ||
      p.name.toLowerCase().includes(` ${lower}`) ||
      p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(lower))
  );

  let remote = [];
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
    const data = await yahooJson(url);
    remote = (data.quotes || [])
      .filter((x) => x.symbol)
      .filter((x) => {
        const t = (x.quoteType || '').toUpperCase();
        return t === 'EQUITY' || t === 'ETF' || t === 'MUTUALFUND' || t === 'INDEX' || !t;
      })
      .map((x) => ({
        symbol: x.symbol,
        name: x.shortname || x.longname || x.symbol,
        type: x.quoteType || x.typeDisp || '',
        exchange: x.exchDisp || '',
      }));
  } catch {
    remote = [];
  }

  const seen = new Set();
  const merged = [];
  for (const item of [...local, ...remote]) {
    const key = item.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged.slice(0, 10);
}

export { RANGES };
