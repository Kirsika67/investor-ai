import { NextResponse } from 'next/server';
import { getTopMovers, getTrendScreener, TREND_TYPES } from '../../../lib/yahoo';
import { getTrendNews, getMarketNewsRss } from '../../../lib/newsRss';
import { cached } from '../../../lib/cache';

function topicsPayload() {
  return TREND_TYPES.map(({ id, label }) => ({ id, label }));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';
  const valid = TREND_TYPES.some((t) => t.id === type) ? type : 'all';

  try {
    const data = await cached(`trends-v2:${valid}`, 4 * 60 * 1000, async () => {
      if (valid === 'all') {
        const movers = await getTopMovers();
        const symbols = [
          ...new Set(
            [
              ...(movers.mostActive || []).slice(0, 3),
              ...(movers.gainers || []).slice(0, 3),
              ...(movers.losers || []).slice(0, 2),
            ]
              .map((m) => m.symbol)
              .filter(Boolean)
          ),
        ];
        let trendNews = { items: [] };
        try {
          trendNews = await getTrendNews(symbols);
        } catch {
          try {
            const hot = await getMarketNewsRss();
            trendNews = { items: (hot.items || []).slice(0, 8) };
          } catch {
            trendNews = { items: [] };
          }
        }
        return { type: 'all', movers, trendNews, source: movers.source };
      }

      if (valid === 'news') {
        let trendNews = { items: [] };
        try {
          const movers = await getTopMovers();
          const symbols = [
            ...(movers.mostActive || []).slice(0, 4),
            ...(movers.gainers || []).slice(0, 3),
          ].map((m) => m.symbol);
          trendNews = await getTrendNews(symbols);
        } catch {
          try {
            trendNews = await getMarketNewsRss();
          } catch {
            trendNews = { items: [] };
          }
        }
        return { type: 'news', movers: { gainers: [], losers: [], mostActive: [] }, trendNews };
      }

      const screen = await getTrendScreener(valid);
      return {
        type: valid,
        movers: {
          gainers: screen.kind === 'up' ? screen.items : [],
          losers: screen.kind === 'down' ? screen.items : [],
          mostActive: screen.kind === 'active' ? screen.items : [],
          custom: screen.items,
          customKind: screen.kind,
          customTitle: screen.title,
        },
        trendNews: { items: [] },
        source: 'yahoo',
      };
    });

    return NextResponse.json({ ...data, topics: topicsPayload() });
  } catch (err) {
    return NextResponse.json({
      error: err.message,
      type: valid,
      movers: { gainers: [], losers: [], mostActive: [] },
      trendNews: { items: [] },
      topics: topicsPayload(),
    });
  }
}
