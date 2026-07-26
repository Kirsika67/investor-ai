const BASE_URL = 'https://www.alphavantage.co/query';

function apiKey() {
  const key = process.env.ALPHA_VANTAGE_API_KEY;
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY puudub keskkonnamuutujatest');
  return key;
}

async function avFetch(params) {
  const url = `${BASE_URL}?${new URLSearchParams({ ...params, apikey: apiKey() })}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error('Alpha Vantage päring ebaõnnestus');
  return res.json();
}

function parsePct(value) {
  if (value == null) return 0;
  return parseFloat(String(value).replace('%', '').replace('+', '')) || 0;
}

export async function getQuote(symbol) {
  const data = await avFetch({ function: 'GLOBAL_QUOTE', symbol });
  const quote = data['Global Quote'];

  if (!quote || !quote['05. price']) {
    return { symbol, valid: false };
  }

  return {
    symbol,
    price: parseFloat(quote['05. price']),
    change: parseFloat(quote['09. change']),
    changePercent: parsePct(quote['10. change percent']),
    valid: true,
  };
}

function mapMover(row) {
  return {
    symbol: row.ticker,
    price: parseFloat(row.price),
    change: parseFloat(row.change_amount),
    changePercent: parsePct(row.change_percentage),
    volume: row.volume,
  };
}

export async function getTopMovers() {
  const data = await avFetch({ function: 'TOP_GAINERS_LOSERS' });

  if (data.Note || data.Information || !data.top_gainers) {
    const msg = data.Note || data.Information || 'Top movers andmed puuduvad';
    throw new Error(msg);
  }

  return {
    lastUpdated: data.last_updated || new Date().toISOString(),
    gainers: (data.top_gainers || []).slice(0, 8).map(mapMover),
    losers: (data.top_losers || []).slice(0, 8).map(mapMover),
    mostActive: (data.most_actively_traded || []).slice(0, 8).map(mapMover),
  };
}

export async function getNews({ limit = 12 } = {}) {
  const data = await avFetch({
    function: 'NEWS_SENTIMENT',
    sort: 'LATEST',
    limit: String(limit),
  });

  if (data.Note || data.Information) {
    throw new Error(data.Note || data.Information);
  }

  const feed = data.feed || [];
  return {
    items: feed.map((item) => {
      const ticker = item.ticker_sentiment?.[0];
      return {
        id: item.url,
        title: item.title,
        summary: item.summary,
        source: item.source,
        url: item.url,
        time: item.time_published,
        image: item.banner_image || null,
        sentiment: item.overall_sentiment_label,
        tickers: (item.ticker_sentiment || []).slice(0, 3).map((t) => ({
          symbol: t.ticker,
          score: parseFloat(t.ticker_sentiment_score),
        })),
        primaryTicker: ticker?.ticker || null,
      };
    }),
  };
}

export function buildTodayBrief({ movers, news }) {
  const topGainer = movers?.gainers?.[0];
  const topLoser = movers?.losers?.[0];
  const active = movers?.mostActive?.[0];
  const headlines = (news?.items || []).slice(0, 3).map((n) => n.title);

  const lines = [];
  if (topGainer) {
    lines.push(
      `Tõusja: ${topGainer.symbol} ${topGainer.changePercent >= 0 ? '+' : ''}${topGainer.changePercent.toFixed(2)}%`
    );
  }
  if (topLoser) {
    lines.push(
      `Langeja: ${topLoser.symbol} ${topLoser.changePercent.toFixed(2)}%`
    );
  }
  if (active) {
    lines.push(`Kõige aktiivsem: ${active.symbol}`);
  }

  return {
    headline: headlines[0] || 'Turu ülevaade uueneb…',
    bullets: lines,
    headlines,
    generatedAt: new Date().toISOString(),
  };
}
