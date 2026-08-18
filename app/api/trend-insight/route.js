import { NextResponse } from 'next/server';
import { getQuotes } from '../../../lib/yahoo';
import { getTrendNews } from '../../../lib/newsRss';
import { cached } from '../../../lib/cache';

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

function shortWhy({ kind, changePercent, name }) {
  const pct = fmtPct(changePercent);
  const who = name || '';
  if (kind === 'growth') {
    return `${who ? `${who}: ` : ''}Yahoo growth-tech nimekirjas (${pct}). See on kasvuettevõte, mitte päeva tipptõusja — täna võib hind olla miinuses.`;
  }
  if (kind === 'value') {
    return `${who ? `${who}: ` : ''}undervalued-growth nimekirjas (${pct}). Turg hindab kasvu odavamalt.`;
  }
  if (kind === 'smallcap') {
    return `${who ? `${who}: ` : ''}small-cap nimekirjas (${pct}).`;
  }
  if (kind === 'shorted') {
    return `${who ? `${who}: ` : ''}enim shortitud nimekirjas (${pct}).`;
  }
  if (kind === 'up') {
    return `${who ? `${who}: ` : ''}päeva tipptõusjate seas (${pct}). Liikumine on kuum, sest tõus toob kauplejaid ja pealkirju — allpool uudised ja analüüs, kas katalüsaator on päris või ainult momentum.`;
  }
  if (kind === 'down') {
    return `${who ? `${who}: ` : ''}päeva suurimate langejate seas (${pct}). Langeja on fookuses, sest müük ja pealkirjad kiirendavad üksteist — loe, kas põhjus on ajutine või struktuurne.`;
  }
  if (kind === 'active') {
    return `${who ? `${who}: ` : ''}tänase kõige aktiivsemate seas (${pct}). Suur maht = institutsioonid ja jaeinvestorid on selles nimes sees, seega on info ja volatiilsus kõrgem.`;
  }
  return `${who || 'See teema'} on uudistes — turu tähelepanu võib hinda liigutada.`;
}

function localAnalysis({ symbol, kind, quote, headlines }) {
  const name = quote?.name || symbol;
  const pct = fmtPct(quote?.changePercent);
  const price = quote?.price != null ? `$${Number(quote.price).toFixed(2)}` : null;
  const lines = [];

  lines.push(`**Miks ${symbol} on selles nimekirjas?**`);

  if (kind === 'growth') {
    lines.push(
      `${name} on Yahoo **growth-tech** nimekirjas (${pct}${price ? `, hind ${price}` : ''}). See tähendab kasvuprofiili, mitte et täna peab olema plussis. Miinus täna on tavaline — küsi, kas P/E/PEG on mõistlik.`
    );
  } else if (kind === 'value') {
    lines.push(
      `${name} on undervalued-growth nimekirjas (${pct}${price ? `, hind ${price}` : ''}). Fookus on odavam kasv, mitte päeva nool.`
    );
  } else if (kind === 'smallcap') {
    lines.push(
      `${name} on small-cap nimekirjas (${pct}${price ? `, hind ${price}` : ''}). Väiksemad nimed on volatiilsemad.`
    );
  } else if (kind === 'shorted') {
    lines.push(
      `${name} on enim shortitud nimekirjas (${pct}${price ? `, hind ${price}` : ''}). Palju vastaspositsioone.`
    );
  } else if (kind === 'up') {
    lines.push(
      `${name} on päeva tipptõusjate seas (${pct}${price ? `, hind ${price}` : ''}). Selline liikumine tõmbab lühiajalisi kauplejaid ja algoritme; “hea” on see siis, kui tõusu toetab selge katalüsaator (tulemused, leping, sektori uudis) — mitte ainult tühine squeeze.`
    );
  } else if (kind === 'down') {
    lines.push(
      `${name} on päeva suurimate langejate seas (${pct}${price ? `, hind ${price}` : ''}). Langeja on kuum, sest pealkirjad ja stop-loss’id kiirendavad müüki. “Hea” võimalus tekib alles siis, kui saad aru *miks* müüakse — ja kas fakt on ajutine või struktuurne.`
    );
  } else if (kind === 'active') {
    lines.push(
      `${name} on kõige aktiivsemate hulgas (${pct}${price ? `, ${price}` : ''}). Maht = tähelepanu. See ei tähenda automaatselt ostu; see tähendab, et info liigub kiiresti ja libisemine/volatiilsus on suurem.`
    );
  } else {
    lines.push(`${name} on uudiste voos. Uudis teeb nime kuumaks, kui see muudab kasumiootust, juhatust või sektori narratiivi.`);
  }

  if (headlines.length) {
    lines.push('**Seotud uudised (kokkuvõte):**');
    lines.push(...headlines.slice(0, 4).map((h, i) => `${i + 1}. ${h}`));
    lines.push(
      'AI loeb neid pealkirju taustaks: kui pealkirjad kordavad sama teemat (nt AI, chip, regulatsioon), on liikumine tõenäolisemalt narratiivi-põhine; kui pealkirjad on hajusad, on see pigem tehniline/mahu-müra.'
    );
  } else {
    lines.push('Värskeid pealkirju just ei tulnud — liikumine võib olla tehniline (optsioonid, ETF-rebalance, sektorirotatsioon).');
  }

  lines.push(
    '**Praktiliselt:** ära osta ainult “kuumuse” pärast. Küsi: (1) mis uudis/fakt?, (2) kas see muudab 6–12 kuu loogikat?, (3) kui suure osakaalu portfellist see väärib?'
  );

  return lines.join('\n\n');
}

async function callOpenAI({ symbol, kind, quote, headlines }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const pct = fmtPct(quote?.changePercent);
  const price = quote?.price != null ? `$${Number(quote.price).toFixed(2)}` : 'n/a';
  const kindLabel =
    {
      up: 'päeva tõusja',
      down: 'päeva langeja',
      active: 'kõige aktiivsem',
      growth: 'growth-tech nimekiri (mitte päeva tõusja)',
      value: 'undervalued growth',
      smallcap: 'small cap',
      shorted: 'enim shortitud',
    }[kind] || 'uudistes';

  const system = `Sa oled Investor AI. Kirjuta eesti keeles professionaalne, selge trendianalüüs.
Struktuur:
1) Miks see sümbol just praegu kuum on (1–2 lõiku)
2) Mida uudised vihjavad (kui pealkirju on)
3) Kas/kuidas investor võiks seda tõlgendada (riskid + mida jälgida)
Ära anna kindlat osta/müü käsku. Ära leiuta fakte pealkirjadest väljaspool. 180–280 sõna.`;

  const user = `Sümbol: ${symbol} (${quote?.name || symbol})
Staatus: ${kindLabel}
Hind: ${price}, päevane muutus: ${pct}
Uudiste pealkirjad:
${headlines.length ? headlines.map((h) => `- ${h}`).join('\n') : '(pealkirju pole)'}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.5,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'OpenAI viga');
  return data.choices?.[0]?.message?.content || null;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = String(searchParams.get('symbol') || '').toUpperCase().trim();
    const kind = searchParams.get('kind') || 'active';
    const changePercent = searchParams.get('changePercent');

    if (!symbol) {
      return NextResponse.json({ error: 'symbol puudub' }, { status: 400 });
    }

    const cacheKey = `trend-insight:${symbol}:${kind}`;
    const payload = await cached(cacheKey, 3 * 60 * 1000, async () => {
      let quote = null;
      try {
        const quotes = await getQuotes([symbol]);
        quote = quotes[0] || null;
      } catch {
        quote = null;
      }

      if (quote && changePercent != null && quote.changePercent == null) {
        quote = { ...quote, changePercent: Number(changePercent) };
      }

      let newsItems = [];
      try {
        const news = await getTrendNews([symbol]);
        newsItems = (news.items || []).slice(0, 8).map((n) => ({
          title: decodeEntities(n.title),
          summary: decodeEntities(n.summary || ''),
          url: n.url,
          source: n.source,
          time: n.time,
          publishedAt: n.publishedAt,
        }));
      } catch {
        newsItems = [];
      }

      const headlines = newsItems.map((n) => n.title).filter(Boolean);
      const blurb = shortWhy({
        kind,
        changePercent: quote?.changePercent ?? Number(changePercent),
        name: quote?.name,
      });

      let analysis = null;
      let mode = 'local';
      let warning = null;
      try {
        analysis = await callOpenAI({ symbol, kind, quote, headlines });
        if (analysis) mode = 'openai';
      } catch (e) {
        warning = e.message;
      }
      if (!analysis) {
        analysis = localAnalysis({ symbol, kind, quote, headlines });
        mode = warning ? 'local_fallback' : 'local';
      }

      return {
        symbol,
        kind,
        blurb,
        analysis: decodeEntities(analysis),
        quote: quote
          ? {
              symbol: quote.symbol,
              name: quote.name,
              price: quote.price,
              changePercent: quote.changePercent,
            }
          : null,
        news: newsItems,
        mode,
        warning,
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
