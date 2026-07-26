import { NextResponse } from 'next/server';
import { getTrendNews } from '../../../lib/newsRss';
import { cached } from '../../../lib/cache';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ items: [] });
  }

  try {
    const data = await cached(`news-v2:${symbol.toUpperCase()}`, 10 * 60 * 1000, () =>
      getTrendNews([symbol.toUpperCase()])
    );
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ items: [], error: err.message });
  }
}
