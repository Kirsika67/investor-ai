import { NextResponse } from 'next/server';
import { getFundamentals, getQuotes } from '../../../lib/yahoo';
import { computeValuation } from '../../../lib/valuation';
import { cached } from '../../../lib/cache';

const lastGood = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'symbol puudub' }, { status: 400 });
  }

  const upper = symbol.toUpperCase();
  const key = `analyze:${upper}`;

  try {
    const payload = await cached(key, 5 * 60 * 1000, async () => {
      let quote = null;
      try {
        const quotes = await getQuotes([upper]);
        quote = quotes?.[0] || null;
      } catch {
        quote = null;
      }

      let fundamentals = {};
      try {
        fundamentals = await getFundamentals(upper);
      } catch {
        fundamentals = {};
      }

      const metrics = {
        symbol: upper,
        name: quote?.name || upper,
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
        pe: fundamentals.pe ?? quote?.pe ?? null,
        forwardPE: fundamentals.forwardPE ?? null,
        pegRatio: fundamentals.pegRatio ?? null,
        priceToBook: fundamentals.priceToBook ?? null,
        bookValue: fundamentals.bookValue ?? null,
        eps: fundamentals.eps ?? quote?.eps ?? null,
        yield: fundamentals.yield ?? quote?.yield ?? null,
        beta: fundamentals.beta ?? quote?.beta ?? null,
        marketCap: fundamentals.marketCap ?? quote?.marketCap ?? null,
        fiftyTwoWeekHigh: fundamentals.fiftyTwoWeekHigh ?? null,
        fiftyTwoWeekLow: fundamentals.fiftyTwoWeekLow ?? null,
        profitMargins: fundamentals.profitMargins ?? null,
        revenueGrowth: fundamentals.revenueGrowth ?? null,
        earningsGrowth: fundamentals.earningsGrowth ?? null,
        sector: fundamentals.sector ?? null,
        industry: fundamentals.industry ?? null,
        quoteType: fundamentals.quoteType ?? null,
      };

      const valuation = computeValuation(metrics);

      return {
        symbol: upper,
        metrics,
        valuation,
        updatedAt: new Date().toISOString(),
      };
    });

    lastGood.set(key, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const stale = lastGood.get(key);
    if (stale) {
      return NextResponse.json({ ...stale, stale: true, warning: err.message });
    }
    return NextResponse.json({ error: err.message }, { status: 200 });
  }
}
