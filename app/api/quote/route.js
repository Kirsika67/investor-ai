import { NextResponse } from 'next/server';
import { getQuote } from '../../../lib/alphaVantage';
import { getChart } from '../../../lib/yahoo';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Sümbol on vajalik' }, { status: 400 });
  }

  const upper = symbol.toUpperCase();

  // Eelistame Yahoo't (ilma AV päevalimiidita)
  try {
    const chart = await getChart(upper, '1D');
    return NextResponse.json({
      symbol: chart.symbol,
      price: chart.price,
      change: chart.change,
      changePercent: chart.changePercent,
      valid: chart.price != null,
      name: chart.name,
    });
  } catch {
    // fallback Alpha Vantage
  }

  try {
    const quote = await getQuote(upper);
    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json({ error: err.message, symbol: upper, valid: false }, { status: 200 });
  }
}
