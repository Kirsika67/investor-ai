import { NextResponse } from 'next/server';
import { cached } from '../../../lib/cache';
import { getTopMovers as getYahooMovers } from '../../../lib/yahoo';
import { getTopMovers as getAvMovers, buildTodayBrief } from '../../../lib/alphaVantage';
import { getMarketNewsRss, getTrendNews } from '../../../lib/newsRss';

const TTL = 5 * 60 * 1000;

export async function GET() {
  try {
    const data = await cached('market-dashboard-v5-tape', TTL, async () => {
      let news = { items: [] };
      let newsError = null;
      try {
        news = await getMarketNewsRss();
      } catch (e) {
        newsError = e.message;
      }

      let movers = { gainers: [], losers: [], mostActive: [], lastUpdated: null };
      let moversError = null;

      try {
        movers = await getYahooMovers();
      } catch (e) {
        moversError = e.message;
        try {
          movers = await getAvMovers();
          moversError = null;
        } catch (avErr) {
          moversError = `${e.message}; AV: ${avErr.message}`;
        }
      }

      const trendSymbols = [
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
        trendNews = await getTrendNews(trendSymbols);
      } catch {
        // ignore — ülduudised jäävad
      }

      if (trendNews.items.length < 4 && trendSymbols.length) {
        const lower = trendSymbols.map((s) => s.toLowerCase());
        const matched = (news.items || []).filter((item) => {
          const hay = `${item.title} ${item.summary}`.toLowerCase();
          return lower.some((s) => hay.includes(s));
        });
        const seen = new Set(trendNews.items.map((i) => i.url));
        for (const item of matched) {
          if (seen.has(item.url)) continue;
          trendNews.items.push(item);
          seen.add(item.url);
        }
      }

      const brief = buildTodayBrief({ movers, news });
      if (!movers.gainers?.length && (newsError || moversError)) {
        brief.bullets = [
          ...(brief.bullets || []),
          newsError ? `Uudised: ${newsError}` : null,
          moversError ? `Trendid: ${moversError}` : null,
        ].filter(Boolean);
      }

      const tape = [
        ...(movers.gainers || []).slice(0, 8),
        ...(movers.losers || []).slice(0, 8),
        ...(movers.mostActive || []).slice(0, 4),
      ];

      const alertTape =
        tape.length > 0
          ? tape
          : news.items.slice(0, 10).map((n) => ({
              symbol: n.source || 'NEWS',
              price: null,
              changePercent: 0,
              title: n.title,
            }));

      return {
        movers,
        news,
        trendNews,
        brief,
        tape: alertTape,
        meta: { newsError, moversError, trendSymbols, source: movers.source || null },
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      {
        error: err.message,
        movers: { gainers: [], losers: [], mostActive: [] },
        news: { items: [] },
        trendNews: { items: [] },
        brief: {
          headline: 'Andmeid ei õnnestunud laadida',
          bullets: [err.message],
          headlines: [],
          generatedAt: new Date().toISOString(),
        },
        tape: [],
      },
      { status: 200 }
    );
  }
}
