import { NextResponse } from 'next/server';
import { getQuotes } from '../../../lib/yahoo';
import { cached } from '../../../lib/cache';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbols = (searchParams.get('symbols') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!symbols.length) {
    return NextResponse.json({ error: 'symbols puudub' }, { status: 400 });
  }

  try {
    const key = `quotes:${symbols.map((s) => s.toUpperCase()).sort().join(',')}`;
    const data = await cached(key, 12 * 1000, async () => ({
      quotes: await getQuotes(symbols),
    }));
    return NextResponse.json({
      ...data,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message, quotes: [] }, { status: 200 });
  }
}
