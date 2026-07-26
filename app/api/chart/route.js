import { NextResponse } from 'next/server';
import { getChart } from '../../../lib/yahoo';
import { cached } from '../../../lib/cache';

const lastGood = new Map();

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '1D';

  if (!symbol) {
    return NextResponse.json({ error: 'symbol puudub' }, { status: 400 });
  }

  const key = `chart:${symbol.toUpperCase()}:${range}`;
  try {
    const data = await cached(key, 20 * 1000, () => getChart(symbol, range));
    lastGood.set(key, data);
    return NextResponse.json(data);
  } catch (err) {
    const stale = lastGood.get(key);
    if (stale) {
      return NextResponse.json({ ...stale, stale: true, warning: err.message });
    }
    return NextResponse.json({ error: err.message }, { status: 200 });
  }
}
