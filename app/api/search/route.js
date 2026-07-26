import { NextResponse } from 'next/server';
import { searchSymbols } from '../../../lib/yahoo';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  try {
    const results = await searchSymbols(q);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err.message, results: [] }, { status: 200 });
  }
}
