import { NextResponse } from 'next/server';
import { getQuotes, getFundamentals } from '../../../lib/yahoo';
import { getTrendNews } from '../../../lib/newsRss';
import { computeValuation, formatValuationForChat } from '../../../lib/valuation';

const FOCUS_LABELS = {
  market: 'Turuülevaade',
  etf: 'ETF-id ja fondid',
  risk: 'Risk ja hajutamine',
  news: 'Uudiste mõju',
};

const KNOWN = {
  SMH: {
    name: 'VanEck Semiconductor ETF',
    kind: 'etf',
    tracks: 'USA suurte pooljuhtide / pooljuht-seadmete ettevõtete korvi',
    note: 'Kitsas sektorifond (AI/chip tsükkel). Tõuseb tugevalt headel aastatel, aga langeb ka teravalt, kui pooljuhtide nõudlus või valuatsioonid jahenevad.',
  },
  SOXX: {
    name: 'iShares Semiconductor ETF',
    kind: 'etf',
    tracks: 'USA pooljuhtide sektorit',
    note: 'SMH-ga sarnane kitsas chip-ETF; vali pigem kulu ja täpse koostise järgi.',
  },
  VOO: {
    name: 'Vanguard S&P 500 ETF',
    kind: 'etf',
    tracks: 'S&P 500 indeksit (lai USA turg)',
    note: 'Lai hajutus, madal kulu — hea tuumportfelli alus.',
  },
  SPY: {
    name: 'SPDR S&P 500 ETF Trust',
    kind: 'etf',
    tracks: 'S&P 500 indeksit',
    note: 'Lai turg; likviidsem, aga tavaliselt veidi kallim kui VOO.',
  },
  QQQ: {
    name: 'Invesco QQQ Trust',
    kind: 'etf',
    tracks: 'Nasdaq-100 (suured tech-raskusega nimed)',
    note: 'Laiem kui SMH, aga tech-raskem kui S&P 500.',
  },
  VTI: {
    name: 'Vanguard Total Stock Market ETF',
    kind: 'etf',
    tracks: 'kogu USA aktsiaturgu',
    note: 'Veel laiem kui S&P 500; hea tuum.',
  },
  NVDA: {
    name: 'NVIDIA',
    kind: 'stock',
    tracks: 'üksik aktsia — AI/GPU',
    note: 'Kontsentreeritud üksikrisk; palju volatiilsem kui SMH või QQQ.',
  },
  AAPL: { name: 'Apple', kind: 'stock', tracks: 'üksik aktsia', note: 'Suur tech; stabiilsem kui paljud kasvunimed, aga ikkagi üksikrisk.' },
  MSFT: { name: 'Microsoft', kind: 'stock', tracks: 'üksik aktsia', note: 'Lai tarkvara/pilve/AI positsioon; üksikrisk jääb.' },
  GOOGL: { name: 'Alphabet', kind: 'stock', tracks: 'üksik aktsia', note: 'Search/cloud/AI; üksikrisk.' },
  AMZN: { name: 'Amazon', kind: 'stock', tracks: 'üksik aktsia', note: 'E-commerce + AWS; üksikrisk.' },
  META: { name: 'Meta Platforms', kind: 'stock', tracks: 'üksik aktsia', note: 'Social + AI investeeringud; üksikrisk.' },
  TSLA: { name: 'Tesla', kind: 'stock', tracks: 'üksik aktsia', note: 'Kõrge volatiilsus; sobib ainult väikese osakaaluga.' },
  AMD: { name: 'AMD', kind: 'stock', tracks: 'üksik aktsia — pooljuhid', note: 'Chip-sektori üksikrisk; volatiilsem kui SMH korv.' },
  AVGO: { name: 'Broadcom', kind: 'stock', tracks: 'üksik aktsia — pooljuhid', note: 'Sageli SMH tippkomponent; üksikrisk.' },
  TSM: { name: 'TSMC', kind: 'stock', tracks: 'üksik aktsia — foundry', note: 'Globaalne tootmisrisk + geopolitika.' },
};

const STOP = new Set([
  'A', 'I', 'AI', 'USA', 'ETF', 'PE', 'CEO', 'IPO', 'USD', 'EUR', 'OK', 'JA', 'ON', 'EI', 'KAS', 'MIS', 'KUI',
  'THE', 'AND', 'FOR', 'TO', 'IN', 'OF', 'OR', 'IT', 'IS', 'BE', 'AT', 'BY', 'AN', 'AS',
]);

function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function extractSymbols(text) {
  const found = [];
  const normalized = String(text || '')
    .replace(/([A-Za-z]{1,5})[-'’`]?(sse|le|ga|st|ks|na|ksse)\b/gi, '$1')
    .toUpperCase();

  // $NVDA stiil
  for (const m of normalized.matchAll(/\$([A-Z]{1,5}(?:-[A-Z])?)/g)) {
    if (!STOP.has(m[1]) && !found.includes(m[1])) found.push(m[1]);
  }

  // Ainult teadaolevad / usaldusväärsed tickerid — väldi eesti sõnade tükeldamist (nt MÕTET → M, TET)
  for (const sym of Object.keys(KNOWN)) {
    const re = new RegExp(`(?:^|[^A-Z])${sym}(?:[^A-Z]|$)`);
    if (re.test(normalized) && !found.includes(sym)) found.push(sym);
  }

  return found.slice(0, 4);
}

function detectIntent(q) {
  const t = q.toLowerCase();
  if (/crypto|krüpto|bitcoin|btc|ethereum|eth|solana|meme.?coin|altcoin|stablecoin/.test(t)) {
    return 'crypto';
  }
  if (/uudis|headline|mis juhtus|miks (tõus|lange)/.test(t)) return 'news';
  if (/risk|volatiil|kui palju kaot|drawdown|hajut/.test(t)) return 'risk';
  if (/võrdle|vs\b|või\b.*parem|erinevus/.test(t)) return 'compare';
  // Analüüs / valuatsioon / P/E / kas mõistlik → täispikk arvutuslik vastus
  if (
    /analüüs|analyys|analyze|valuat|p\/e|pe suhe|peg|õiglane hind|kas .*mõistlik|kas .*kallis|kas .*odav|kas .*mõtet|kas .*tasub|kas .*invest|osta|müü|veel invest|sisse panna|positsioon/.test(
      t
    )
  ) {
    return 'invest';
  }
  if (/mis on|mis fond|selgita|tutvusta/.test(t)) return 'explain';
  if (/räägi|lähemalt|rohkem|detail|täpsusta|selgita (veel|lähemalt)/.test(t)) return 'deepen';
  if (/hind|kui palju|muutus|tõus|langus|performance|tootlus/.test(t)) return 'price';
  return 'general';
}

function isFollowUp(q) {
  const t = q.toLowerCase().trim();
  if (extractSymbols(q).length) return false;
  // Must reference investing/finance context to be a follow-up
  const financeWords = /aktsia|fond|etf|invest|portfel|hind|turg|ost|müü|dividend|risk|tootlus|valuats|p\/e|peg|anal|börs|sektor|crypto|krüpto/;
  if (/sellest|seda|selle|eelmis|mainitud|sama|lähemalt|rohkem|täpsusta|jätka|räägi (veel|lähemalt|rohkem)/.test(t)) {
    return true;
  }
  // Short continuation words only if finance-related
  if (t.length < 60 && /^(ja|aga|ok|okei|selge|jah|ei|miks|kuidas|millal)\b/.test(t) && financeWords.test(t)) return true;
  // Very short generic follow-ups (2-3 words like "ja risk?" or "miks langeb?")
  if (t.split(/\s+/).length <= 3 && /^(ja|aga|miks|kuidas)\b/.test(t)) return true;
  return false;
}

function symbolsFromHistory(messages) {
  const found = [];
  for (const m of messages) {
    for (const s of extractSymbols(m.content || '')) {
      if (!found.includes(s)) found.push(s);
    }
  }
  return found.slice(0, 4);
}

function lastAssistantSnippet(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')?.content || '';
  return last.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildSystemPrompt(prefs, marketLines, valuationBlock) {
  const focus = FOCUS_LABELS[prefs?.focus] || FOCUS_LABELS.market;
  const market = marketLines.length
    ? `\nReaalajas andmed (kasuta ainult kui asjakohane):\n${marketLines.join('\n')}`
    : '';
  const val = valuationBlock
    ? `\n\n${valuationBlock}\n\nKOHUSTUSLIK: kui kasutaja küsib analüüsi / kas osta / kas mõistlik, NÄITA need arvutused vastuses (P/E, PEG, õiglane hind, tippinvestorite filtrid). Ära räägi üldsõnaliselt — arvuta ja tõlgenda.`
    : '';

  return `Sa oled Investor AI — professionaalne aktsiaanalüütik eesti keeles.
Sa EI ole Claude ega ChatGPT kloon. Stiil: selge, numbriline, veidi terav, nagu hea research note — mitte üldsõnaline coach.

REEGLID:
1. See on JÄTKUV VESTLUS. Kasuta kogu eelnevat sõnumilugu.
2. Vasta TÄPSELT kasutaja küsimusele. Kui ta ütleb “Analüüsi AMD”, anna kohe täispikk valuatsiooniarvutus. Kui ta küsib üldist investeerimisküsimust (nt "kas alustada", "kuidas hajutada", "mis on ETF"), vasta SELLELE — ära sunni sümbolit peale.
3. Ära korda küsimust. Ära kasuta malle ega „Sinu küsimus:”.
4. Ole aus; ära anna kindlat osta/müü käsku, aga anna SELGE hinnang: odavam / õiglane / kallim + miks.
5. Ära leiuta hindu ega kordajaid. Kasuta ainult ARVUTATUD VALUATSIOON plokis olevaid numbreid.
6. Too sisse tippinvestorite loogika (nimeliselt): Benjamin Graham (P/E, P/B, margin of safety), Peter Lynch (PEG), Warren Buffett (earnings yield / kvaliteet).
7. Sa PEAD vastama KÕIKIDELE investeerimisega seotud küsimustele: alustamine, strateegiad, riskid, portfelli ülesehitus, ETF vs aktsia, dividendid, maksuteemad, psühholoogia jne.
8. Fookusevihje (ainult kui aitab): ${focus}.${market}${val}

PIKKUS JA STRUKTUUR (analüüs / kas investeerida):
Kirjuta PIKK research-stiilis vastus (umbes 450–700 sõna), mitte 3–4 lauset.
Kasuta pealkirju:
**Mis me arvutame**
**Numbrid ja õiglane hind**
**Graham / Lynch / Buffett**
**Argumendid POOLT**
**Argumendid VASTU / riskid**
**Kokkuvõte (kas tundub mõistlik)**
Iga plokk sisukas. Lõpus üks lühike disclaimer: ei ole isiklik soovitus.`;
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return null;
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function callOpenAI({ system, messages }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.55,
      max_tokens: 2800,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || 'OpenAI päring ebaõnnestus');
  }
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    throw new Error('OpenAI tagastas tühja vastuse');
  }
  return content;
}

function priceLine(quote) {
  if (!quote) return null;
  const p = fmtPrice(quote.price);
  const pct = fmtPct(quote.changePercent);
  if (!p) return null;
  const name = quote.name && quote.name !== quote.symbol ? ` (${quote.name})` : '';
  return `${quote.symbol}${name}: $${p}${pct ? ` (${pct} täna)` : ''}`;
}

function answerInvest(sym, info, quote, headlines = [], valuationBundle = null) {
  const name = info?.name || quote?.name || sym;
  const kind = info?.kind === 'etf' ? 'ETF' : 'aktsia';
  const price = priceLine(quote);
  const tracks = info?.tracks || (kind === 'ETF' ? 'sektori/indeksi korvi' : 'üksikaktsia äri');
  const note = info?.note || '';
  const newsBits = (headlines || []).slice(0, 3).map((h) => decodeEntities(h)).filter(Boolean);
  const v = valuationBundle?.valuation;
  const m = valuationBundle?.metrics || {};

  const parts = [];

  parts.push(
    `**${sym}** (${name}) — Investor AI valuatsiooniarvutus. All on numbrid, tippinvestorite filtrid, siis poolt/vastu ja selge kokkuvõte. See ei ole ostukäsk.`
  );

  parts.push('**Mis me arvutame**');
  parts.push(
    [
      `• Vaatame, kas praegune hind on **mõistlik** P/E, PEG, P/B ja õiglase hinna suhtes — mitte ainult “kas lugu on ilus”.`,
      `• ${sym} on ${kind}: ${tracks}.`,
      note ? `• Kontekst: ${note}` : null,
      `• Klassika: **Graham** (odavus + margin of safety), **Lynch** (PEG = kasv õiglase hinnaga), **Buffett** (earnings yield + äri kvaliteet).`,
    ]
      .filter(Boolean)
      .join('\n')
  );

  parts.push('**Numbrid ja õiglane hind**');
  if (v && v.label !== 'unknown') {
    const peLine =
      m.pe != null
        ? `Trailing P/E **${Number(m.pe).toFixed(1)}**` +
          (m.forwardPE != null ? ` · forward P/E **${Number(m.forwardPE).toFixed(1)}**` : '')
        : m.forwardPE != null
          ? `Forward P/E **${Number(m.forwardPE).toFixed(1)}**`
          : 'P/E andmed napivad';
    const pegLine = m.pegRatio != null ? `PEG **${Number(m.pegRatio).toFixed(2)}**` : 'PEG puudub';
    const pbLine = m.priceToBook != null ? `P/B **${Number(m.priceToBook).toFixed(2)}**` : 'P/B puudub';
    const epsLine = m.eps != null ? `EPS **$${Number(m.eps).toFixed(2)}**` : 'EPS puudub';
    parts.push(
      [
        price ? `• Turuhind: ${price}` : `• Hind: vaata Watchlistist`,
        `• ${peLine}`,
        `• ${pegLine} · ${pbLine} · ${epsLine}`,
        v.fairLow != null && v.fairHigh != null
          ? `• **Õiglane hind (EPS × mõistlik P/E bänd):** $${Number(v.fairLow).toFixed(2)} – $${Number(v.fairHigh).toFixed(2)}` +
            (v.upsidePct != null
              ? ` → erinevus mudeli keskpunktist **${v.upsidePct >= 0 ? '+' : ''}${v.upsidePct.toFixed(1)}%**`
              : '')
          : `• Õiglast hinda ei saanud täielikult arvutada (EPS/book napib).`,
        v.score != null
          ? `• **Meie skoor: ${v.score}/100 → ${v.labelEt}** (kindlus: ${v.confidence}).`
          : `• Skoori ei saanud usaldusväärselt arvutada.`,
      ].join('\n')
    );
    if (v.reasons?.length) {
      parts.push(v.reasons.map((r) => `• ${r}`).join('\n'));
    }
  } else if (v?.labelEt === 'ETF / fond') {
    parts.push(
      [
        price ? `• ${price}` : null,
        `• ETF/fondi puhul üksikaktsia P/E mudel ei sobi hästi. Hinda kulu, jälgitavat indeksit ja oma riskitaluvust.`,
        `• Võrdle laiema turuga (nt VOO) — kas sektori kontsentratsioon on teadlik valik.`,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else {
    parts.push(
      [
        price ? `• ${price}` : `• Hinnahetke ei saanud.`,
        `• Fundamentaalid (P/E/EPS) ei tulnud täielikult — all on ikkagi kvalitatiivne analüüs; Ava Watchlistis „Kas on mõistlik?“ kui andmed hiljem ilmuvad.`,
      ].join('\n')
    );
  }

  parts.push('**Graham / Lynch / Buffett**');
  if (v?.gurus?.length) {
    parts.push(v.gurus.map((g) => `• **${g.guru}** — ${g.detail}`).join('\n'));
  } else {
    parts.push(
      [
        `• **Graham:** otsis P/E ≤ 15 ja P/E×P/B ≤ 22.5 — “margin of safety”. Kaasaegne tech jääb sellest filtrist sageli välja; siis loeb kvaliteet rohkem kui puhas odavus.`,
        `• **Lynch:** PEG = P/E ÷ kasv%; ≤1 = kasv odavalt, >1.5 = maksad kasvule liiga palju.`,
        `• **Buffett:** pigem suurepärane äri õiglase hinnaga; earnings yield (1/P/E) peab konkureerima võlakirjaga, kui moat on nõrk.`,
      ].join('\n')
    );
  }

  parts.push('**Argumendid POOLT**');
  parts.push(
    [
      `• **Tees.** Kui ${tracks} on sinu 5–10 a narratiiv, on ${sym} loogiline viis sellele panustada.`,
      kind === 'ETF'
        ? `• **Hajutus.** ETF vähendab ühe nime õnnetust võrreldes üksikaktsiaga.`
        : `• **Upside.** Üksikaktsia annab suurema potentsiaali kui lai indeks — kui tees peab.`,
      v?.label === 'cheap'
        ? `• **Valuatsioon toetab.** Meie mudel märgib hetkel **odavam** (skoor ${v.score}) — numbrid ei ütle “osta kohe”, aga hind ei ole mudeli järgi ülepaisutatud.`
        : v?.label === 'fair'
          ? `• **Hind on umbes õiglane.** Ei ole “kingitus”, aga ka mitte ilmne mull meie P/E–PEG raamistikus.`
          : `• **Lugu võib olla tugev isegi kui kordajad on kõrged** — Buffett maksaks kvaliteedi eest; siis pead usaldama moati, mitte ainult P/E-d.`,
      price ? `• **Praegune turg:** ${price} — kasuta taustaks.` : null,
    ]
      .filter(Boolean)
      .join('\n')
  );

  parts.push('**Argumendid VASTU / riskid**');
  parts.push(
    [
      v?.label === 'expensive'
        ? `• **Valuatsioon on range.** Skoor ${v.score}/100 (**${v.labelEt}**) — “hea uudis” võib juba hinnas olla; ootuste langus teeb haiget.`
        : `• **Valuatsioon ja ootused.** Isegi “õiglase” hinna juures võib sentiment ühe kvartaliga −20…−40% teha.`,
      `• **Kontsentratsioon.** ${kind === 'ETF' ? 'Kitsas sektorifond liigub turust enamasti rohkem.' : 'Üksikaktsia idiorisk on suur.'}`,
      `• **Horisont.** Kui raha võib vaja minna 1–2 a jooksul, on ${sym} halb “parkimine”.`,
      `• **Osakaal.** Kui ${sym} on juba suur tükk portfellist, lisamine suurendab riski isegi kui tees on õige.`,
    ].join('\n')
  );

  if (newsBits.length) {
    parts.push('**Uudiste taust**');
    parts.push(
      [...newsBits.map((h) => `• ${h}`), 'Pealkirjad selgitavad *miks* turg räägib — mitte automaatset osta/müü.'].join(
        '\n'
      )
    );
  }

  parts.push('**Kokkuvõte (kas tundub mõistlik)**');
  const verdict =
    v?.label === 'cheap'
      ? `Numbrite järgi tundub **pigem odavam / mõistlikum** (skoor ${v.score}). Sobib kaalumiseks, kui tees ja horisont klapivad.`
      : v?.label === 'fair'
        ? `Numbrite järgi **õiglane** (skoor ${v.score}) — ei ole ilmne allahindlus ega ilmne mull. Otsus sõltub kvaliteedist ja sinu osakaalust.`
        : v?.label === 'expensive'
          ? `Numbrite järgi **kallim** (skoor ${v.score}). “Mõistlik” ainult siis, kui usud erakordset kasvu/moati — Graham/Lynch filtrid on range.`
          : `Andmeid napib täielikuks skooriks — ära otsusta ainult pealkirja pealt; vaata P/E/EPS Watchlistis.`;

  parts.push(
    [
      verdict,
      `**Sobib pigem, kui:** lai baas olemas (nt VOO), ${sym} on satelliit (~5–15%), talud suurt drawdown’i, lisad keskmistades.`,
      `**Pigem ära / ära lisa, kui:** vajad raha varsti, ${sym} on juba liiga suur, või ostad ainult hype’i pärast.`,
      `_Investor AI arvutusmudel (P/E, PEG, P/B, 52W) + Graham/Lynch/Buffett filtrid. Ei ole isiklik finantsnõuanne._`,
    ].join('\n\n')
  );

  return parts.join('\n\n');
}

function answerExplain(sym, info, quote) {
  const name = info?.name || sym;
  const lines = [
    `**${sym}** on ${info?.kind === 'etf' ? 'ETF' : 'aktsia'}: ${name}.`,
  ];
  if (info?.tracks) lines.push(`Mida jälgib / millega tegeleb: ${info.tracks}.`);
  if (info?.note) lines.push(info.note);
  const price = priceLine(quote);
  if (price) lines.push(`Praegu: ${price}.`);
  return lines.join('\n\n');
}

function answerPrice(sym, quote, info) {
  const price = priceLine(quote);
  if (!price) {
    return `Ei saanud just praegu **${sym}** hinda kätte. Proovi hetke pärast uuesti või vaata Watchlistist.`;
  }
  const extra = info?.note ? `\n\n${info.note}` : '';
  return `${price}.${extra}`;
}

function answerRisk(sym, info) {
  if (!sym) {
    return answerCryptoRisk('Milline on kõige riskantsem positsioon praegu?');
  }
  const name = info?.name || sym;
  return [
    `**Argumendid VASTU / riskid — ${sym} (${name})**`,
    info?.kind === 'etf'
      ? [
          `• **Sektoririsk.** Kui teema jahtub, võib fond kauaks alla jääda.`,
          `• **Kõrgem volatiilsus** kui laial indeksil (VOO/SPY).`,
          `• **Kontsentratsioon.** Tipphoidlad liigutavad kogu ETF-i.`,
          `• **Praktika.** Hoia tuum laias turus; ${sym} pigem satelliit (nt ≤10–15%).`,
        ].join('\n')
      : [
          `• **Üksikaktsia risk.** Üks uudis võib hinda tugevalt liigutada.`,
          `• **Likviidsus / timing.** Ära panusta rahaga, mida vajad varsti.`,
          `• **Osakaal.** Määra ette max kahjum ja max % portfellist.`,
          `• **Horisont.** Kui <2 a, on üksiknimi tavaliselt liiga volatiilne.`,
        ].join('\n'),
    'Kui tahad, ütle horisont ja osakaal — teen sellest konkreetsema plaani.',
  ].join('\n\n');
}

function answerCryptoRisk(question) {
  const q = question.toLowerCase();
  const wantsRiskiest = /kõige riskant|riskants|halvim|ohtlik|kõige volatiil/.test(q);

  const parts = [];
  parts.push(
    wantsRiskiest
      ? 'Küsimus “milline crypto on kõige riskantsem?” — lühike tõde: **väikseimad / uued / meme-mündid** on tavaliselt kõige riskantsemad, mitte Bitcoin. All on tasakaalustatud pilt.'
      : 'Crypto riskid erinevad aktsiatest: 24/7 turg, kõrgem volatiilsus, regulatsioon ja nutilepingu-/börsirisk.'
  );

  parts.push('**Kõige riskantsemad (üldiselt)**');
  parts.push(
    [
      '• **Meme-coiniid ja mikro-cap altcoinid** — likviidsus õhuke, pump-and-dump tavaline, −80…−95% ühe nädalaga pole haruldane.',
      '• **Uued / anonüümsed tokenid** — smart-contract bugid, rug pull, insider unlockid.',
      '• **Kõrge leverage’iga futuurid/perps** — likvideerimine võib konto nullida isegi “õige” suuna peal.',
      '• **Väiksed CEX/DEX paarid** — libisemine + hackirisk.',
    ].join('\n')
  );

  parts.push('**Suhteliselt vähem riskantne (aga ikka riskantne)**');
  parts.push(
    [
      '• **Bitcoin (BTC)** — suurim likviidsus ja tuntus; ikkagi võib teha −50%+ bear-turul.',
      '• **Ethereum (ETH)** — smart-contract ökosüsteem; riskid seotud DeFi/regulatsiooniga, aga likviidsus on suur.',
      '• **Suured L1/L2 blue-chip’id** (nt SOL jt) — endiselt kõrge beeta vs BTC.',
    ].join('\n')
  );

  parts.push('**Miks “kõige riskantsem” ei ole üks kindel ticker**');
  parts.push(
    [
      'Risk muutub päevast päeva: mis eile oli “kuum alt”, võib täna olla illikviidne. Seega ära otsi ühte “kõige riskantsemat mündi” spekuleerimiseks — kui eesmärk on riski *mõista*, vaata pigem **kategooriaid** (meme / mikro / leverage).',
      'Kui tahad konkreetset nime, ütle kas räägime **spot** (hoiad mündi) või **futuuridest**, ja kui suur on sinu max kaotus.',
    ].join('\n\n')
  );

  parts.push('**Minu tegelik vastus**');
  parts.push(
    [
      'Kõige riskantsem “crypto” on peaaegu alati **väike/uudne/meme token või kõrge võimendus**, mitte BTC.',
      'Kui hoiad cryptot üldse, hoia tuum BTC/ETH-s, altid väikese osakaaluga, ilma leverage’ita rahaga, mida võid kaotada.',
      'Ma ei anna ostu-/müügikäsku — see on riskiraamistik. Kui tahad, võrdlen BTC vs ETH vs SOL sinu horisondi järgi.',
    ].join('\n\n')
  );

  return parts.join('\n\n');
}

function answerCompare(symbols, quotesBySym) {
  if (symbols.length < 2) {
    return 'Võrdluseks kirjuta kaks sümbolit, nt „võrdle SMH ja VOO“.';
  }
  const [a, b] = symbols;
  const ia = KNOWN[a];
  const ib = KNOWN[b];
  const lines = [`**${a} vs ${b}** — lühike võrdlus:`];
  lines.push(`• **${a}**: ${ia?.note || ia?.tracks || 'spetsiifilisem / kontsentreeritum positsioon'}`);
  lines.push(`• **${b}**: ${ib?.note || ib?.tracks || 'teine riskiprofiil'}`);
  const pa = priceLine(quotesBySym[a]);
  const pb = priceLine(quotesBySym[b]);
  if (pa || pb) {
    lines.push(`Täna: ${[pa, pb].filter(Boolean).join(' · ')}`);
  }
  lines.push('Kui tahad stabiilsemat baasi, eelista laiemat; kui tahad sektori/kasvu panust, kitsam sobib väiksema osakaaluga.');
  return lines.join('\n');
}

function answerNews(question, headlines) {
  const clean = (headlines || [])
    .map(decodeEntities)
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (!clean.length) {
    return 'Just praegu ei ole mul küljes värskeid pealkirju. Ava News-vaade või küsi konkreetse sümboli kohta (nt „SMH uudised”).';
  }

  return [
    'Siin on olulisemad pealkirjad praegu — kasuta neid taustaks, mitte automaatse ostu-/müügisignaalina:',
    ...clean.map((h) => `• ${h}`),
    `\nSinu küsimuse kontekst (“${question.trim()}”): uudis muudab otsust alles siis, kui see muudab ettevõtte/fondi pikaajalist loogikat, mitte ühe päeva pealkirja pärast.`,
  ].join('\n');
}

function answerDeepen(sym, info, quote, prevSnippet, question) {
  const name = info?.name || sym;
  const price = priceLine(quote);
  const q = question.toLowerCase();
  const lines = [];

  lines.push(`Jätkame **${sym}** (${name}) teemal — nagu sa palusid (“${question.trim()}”).`);

  if (/risk|drawdown|kaot|volatiil/.test(q)) {
    lines.push(
      `${sym} on ${info?.kind === 'etf' ? 'kitsas sektori-ETF' : 'üksikpositsioon'}: langused võivad olla järsud. Praktikas määra ette max osakaal (nt ≤10–15% kogu portfellist) ja ära lisa, kui juba oled üle selle.`
    );
  } else if (/hind|tootlus|täna|muutus/.test(q)) {
    lines.push(price ? `Praegu: ${price}.` : `Hinna hetkeandmeid just ei saanud — vaata Watchlistist.`);
  } else if (/osakaal|kui palju|mitu %|portfell/.test(q)) {
    lines.push(
      `Osakaalu jaoks: hoia ${sym} pigem satelliidina (tihti 5–15%), tuum laias indeksis. Kui juba oled üle selle, ära keskmista alla ilma uue katalüsaatorita.`
    );
  } else {
    lines.push(
      info?.note ||
        `${name} juures loeb peamiselt see, kas sinu horisont ja riskitaluvus sobivad selle volatiilsusega.`
    );
    if (info?.tracks) {
      lines.push(`Fond/aktsia loogika: ${info.tracks}.`);
    }
    lines.push(
      `Lähemalt otsuse jaoks: (1) kas sul on juba lai baas (VOO/SPY vms), (2) kas ${sym} on “satelliit” mitte tuum, (3) kas lisad ainult siis, kui teesikees püsib 3–5+ aastat.`
    );
    lines.push(
      'Miks see “hea” või “halb” tundub, sõltub kontekstist: hea satelliit AI/chip tsüklisse, halb kui see asendab kogu hajutatud portfelli.'
    );
  }

  if (price && !/hind|tootlus|täna|muutus/.test(q)) {
    lines.push(`Viide turule: ${price}.`);
  }

  if (prevSnippet) {
    lines.push('Kui tahad, võime järgmisena võrrelda teise fondiga (nt VOO/QQQ) või rääkida konkreetsest osakaalust sinu portfellis.');
  }

  return lines.join('\n\n');
}

function localReply({ messages, context, quotesBySym, valuationBySym }) {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const q = last.trim();
  const currentSymbols = extractSymbols(q);
  const topicChanged = currentSymbols.length > 0;
  const followUp = !topicChanged && isFollowUp(q);
  const historySymbols = symbolsFromHistory(messages);
  // Only fall back to history symbols if this is a genuine follow-up question
  const symbols = currentSymbols.length ? currentSymbols : (followUp ? historySymbols : []);
  const primary = symbols[0] || null;
  const info = primary ? KNOWN[primary] : null;
  const quote = primary ? quotesBySym[primary] : null;
  const valuationBundle = primary ? valuationBySym?.[primary] : null;
  let intent = detectIntent(q);

  // Only deepen if genuinely continuing same topic (no new symbol mentioned)
  if (followUp && !topicChanged && primary && (intent === 'general' || intent === 'deepen' || intent === 'explain')) {
    intent = 'deepen';
  }

  if (primary && intent === 'invest') {
    return answerInvest(primary, info || { name: primary }, quote, context?.headlines || [], valuationBundle);
  }
  if (primary && intent === 'deepen') {
    if (/lähemalt|rohkem|detail|täpsusta|räägi|sellest|seda|analüüs/.test(q.toLowerCase())) {
      return answerInvest(primary, info || { name: primary }, quote, context?.headlines || [], valuationBundle);
    }
    return answerDeepen(primary, info || { name: primary }, quote, lastAssistantSnippet(messages), q);
  }
  if (primary && intent === 'explain') {
    return answerInvest(primary, info || { name: primary }, quote, context?.headlines || [], valuationBundle);
  }
  if (primary && intent === 'price') return answerPrice(primary, quote, info);
  if (intent === 'crypto') return answerCryptoRisk(q);
  if (intent === 'compare') {
    const pair = symbols.length >= 2 ? symbols : primary ? [primary, 'VOO'] : historySymbols;
    return answerCompare(pair, quotesBySym);
  }
  if (intent === 'risk') {
    if (!primary && !historySymbols[0]) {
      if (/crypto|krüpto|btc|eth/.test(q.toLowerCase())) return answerCryptoRisk(q);
      return [
        'Riskist rääkimiseks ütle **mis** (nt SMH, NVDA, BTC).',
        'Üldiselt: kitsas sektor / üksiknimi / meme-crypto / leverage = kõrgem risk; lai indeks = madalam.',
      ].join('\n\n');
    }
    return answerRisk(primary || historySymbols[0], info || KNOWN[historySymbols[0]]);
  }
  if (intent === 'news') return answerNews(q, context?.headlines);

  if (primary) {
    return answerInvest(
      primary,
      info || { name: quote?.name || primary, kind: 'stock' },
      quote,
      context?.headlines || [],
      valuationBundle
    );
  }

  if (/tervit|hei|tere|help|abi/.test(q.toLowerCase())) {
    return 'Tere — olen Investor AI. Küsi aktsia kohta, turu kohta, investeerimise kohta — vastan kõigele.';
  }

  // No symbol, not a simple greeting — let OpenAI handle general investment questions
  return null;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages.slice(-24) : [];
    const prefs = body.prefs || {};
    const context = {
      ...body.context,
      headlines: (body.context?.headlines || []).map(decodeEntities),
    };

    if (!messages.length || !messages.some((m) => m.role === 'user')) {
      return NextResponse.json({ error: 'Küsimus puudub' }, { status: 400 });
    }

    const normalized = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: decodeEntities(String(m.content || '').slice(0, 4000)),
    }));

    const lastUser = [...normalized].reverse().find((m) => m.role === 'user')?.content || '';
    const currentMentioned = extractSymbols(lastUser);
    const isFollowUpMsg = !currentMentioned.length && isFollowUp(lastUser);
    const symbols = currentMentioned.length
      ? [...new Set([...currentMentioned, ...symbolsFromHistory(normalized)])].slice(0, 4)
      : isFollowUpMsg
        ? symbolsFromHistory(normalized).slice(0, 4)
        : [];

    let quotesBySym = {};
    if (symbols.length) {
      try {
        const quotes = await getQuotes(symbols);
        quotesBySym = Object.fromEntries((quotes || []).map((q) => [q.symbol, q]));
      } catch {
        quotesBySym = {};
      }
    }

    // Valuatsiooniarvutus peamise sümboli jaoks
    const valuationBySym = {};
    if (symbols[0]) {
      const sym = symbols[0];
      try {
        const fundamentals = await getFundamentals(sym);
        const q = quotesBySym[sym] || {};
        const metrics = {
          symbol: sym,
          name: q.name || fundamentals.sector || sym,
          price: q.price ?? null,
          pe: fundamentals.pe ?? q.pe ?? null,
          forwardPE: fundamentals.forwardPE ?? null,
          pegRatio: fundamentals.pegRatio ?? null,
          priceToBook: fundamentals.priceToBook ?? null,
          bookValue: fundamentals.bookValue ?? null,
          eps: fundamentals.eps ?? q.eps ?? null,
          yield: fundamentals.yield ?? q.yield ?? null,
          beta: fundamentals.beta ?? q.beta ?? null,
          fiftyTwoWeekHigh: fundamentals.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: fundamentals.fiftyTwoWeekLow ?? null,
          profitMargins: fundamentals.profitMargins ?? null,
          revenueGrowth: fundamentals.revenueGrowth ?? null,
          earningsGrowth: fundamentals.earningsGrowth ?? null,
          sector: fundamentals.sector ?? null,
          industry: fundamentals.industry ?? null,
          quoteType: fundamentals.quoteType ?? null,
        };
        valuationBySym[sym] = {
          metrics,
          valuation: computeValuation(metrics),
        };
      } catch {
        // ignore — local/OpenAI töötab ilma
      }
    }

    // Lisa sümboli uudised konteksti (pika analüüsi jaoks)
    if (symbols[0] && !(context.headlines && context.headlines.length)) {
      try {
        const news = await getTrendNews([symbols[0]]);
        context.headlines = (news.items || []).slice(0, 5).map((n) => decodeEntities(n.title));
      } catch {
        // ignore
      }
    } else if (symbols[0]) {
      try {
        const news = await getTrendNews([symbols[0]]);
        const extra = (news.items || []).slice(0, 4).map((n) => decodeEntities(n.title));
        context.headlines = [...new Set([...(context.headlines || []), ...extra])].slice(0, 6);
      } catch {
        // ignore
      }
    }

    const marketLines = symbols
      .map((s) => priceLine(quotesBySym[s]))
      .filter(Boolean)
      .map((line) => `• ${line}`);

    const primaryVal = symbols[0] ? valuationBySym[symbols[0]] : null;
    const valuationBlock = primaryVal
      ? formatValuationForChat(primaryVal.metrics, primaryVal.valuation)
      : '';

    let system = buildSystemPrompt(prefs, marketLines, valuationBlock);
    if (context.headlines?.length) {
      system += `\n\nSeotud uudiste pealkirjad (kasuta ainult kui asjakohane, ära kleebi toorelt):\n${context.headlines
        .slice(0, 5)
        .map((h) => `• ${h}`)
        .join('\n')}`;
    }

    const lastUserIntent = detectIntent(lastUser);
    const wantsValuation =
      symbols[0] && (lastUserIntent === 'invest' ||
      /analüüs|analyze|mõistlik|p\/e|peg|valuat/i.test(lastUser));

    let reply = null;
    let mode = 'local';
    let openaiError = null;

    // Analüüsiküsimustel eelistame arvutuskindlat local vastust
    if (wantsValuation && symbols[0]) {
      reply = localReply({ messages: normalized, context, quotesBySym, valuationBySym });
      mode = 'valuation';
    }

    // If local didn't produce a reply, always try OpenAI
    if (!reply) {
      try {
        reply = await callOpenAI({ system, messages: normalized });
        if (reply) mode = 'openai';
      } catch (e) {
        openaiError = e.message || 'OpenAI viga';
        console.error('OpenAI error:', openaiError);
      }
    }

    // Final fallback
    if (!reply) {
      reply = localReply({ messages: normalized, context, quotesBySym, valuationBySym });
      mode = openaiError ? 'local_fallback' : 'local';
    }

    if (!reply) {
      const q = lastUser.toLowerCase();
      if (/noor|alusta|algaja|esimene|kuidas alusta/.test(q)) {
        reply = [
          'Investeerimist pole kunagi liiga vara alustada — mida noorem, seda suurem liitintressi eelis.',
          '',
          '**Praktiline samm:**',
          '1. Ava investeerimiskonto (nt LHV, Swedbank, Interactive Brokers)',
          '2. Alusta laia indeksfondiga (nt S&P 500 ETF nagu VOO või VWCE)',
          '3. Investeeri regulaarselt, nt iga kuu kindel summa',
          '4. Ära proovi turgu ajastada — aeg turul > turu ajastamine',
          '',
          '**Miks noorena?** Kui investeerid 100€/kuus 7% tootlusega:',
          '- Alates 20. eluaastast: ~400 000€ 65-aastaselt',
          '- Alates 30. eluaastast: ~190 000€ 65-aastaselt',
          '',
          'Liitintress on võimas. Küsi edasi — räägime portfellist, riskist või konkreetsetest aktsiatest.',
        ].join('\n');
      } else if (/hajut|divers|portfel|jaot/.test(q)) {
        reply = [
          '**Hajutamine** on investeerimise alustala — ära pane kõiki mune ühte korvi.',
          '',
          '**Põhimõtted:**',
          '1. **Varaklass:** aktsiad + võlakirjad + kinnisvara',
          '2. **Geograafia:** USA + Euroopa + arenevad turud',
          '3. **Sektor:** tech + tervishoid + finants + energia',
          '4. **Suurus:** large cap + mid/small cap',
          '',
          '**Lihtne starter-portfell:**',
          '- 70% VWCE (ülemaailmne aktsiad)',
          '- 20% võlakirjad',
          '- 10% üksikaktsiad (kui soovid)',
          '',
          'Küsi konkreetse aktsia kohta — arvutan, kas hind on mõistlik.',
        ].join('\n');
      } else if (/etf|fond|indeks/.test(q)) {
        reply = [
          '**ETF** (Exchange-Traded Fund) on börsil kaubeldav fond, mis jälgib indeksit, sektorit või strateegiat.',
          '',
          '**Miks ETF?**',
          '- Automaatne hajutus (1 ost = sajad aktsiad)',
          '- Madalad tasud (0.03–0.20% aastas)',
          '- Lihtne osta nagu aktsiat',
          '',
          '**Populaarsed ETF-id:**',
          '- **VOO** — S&P 500 (USA suurimad 500)',
          '- **VWCE** — kogu maailma aktsiad',
          '- **SMH** — pooljuhid (AI/chip sektor)',
          '- **QQQ** — Nasdaq 100 (tech-kaldega)',
          '',
          'Küsi konkreetse sümboli kohta — arvutan valuatsiooni.',
        ].join('\n');
      } else if (/risk|ohtl|kaota|turval/.test(q)) {
        reply = [
          '**Investeerimisrisk** sõltub sellest, mida ja kuidas ostad.',
          '',
          '**Madalama riskiga:** lai indeksfond (VOO, VWCE) — ajalooliselt ~7-10% aastas, aga langeb ka 30-40% kriisis.',
          '**Kõrgema riskiga:** üksikaktsiad, sektori-ETF-id (SMH), crypto.',
          '**Kõrgeima riskiga:** optsioonid, leverage, meme-aktsiad.',
          '',
          '**Kuidas riski maandada:**',
          '- Hajuta (mitte ainult tech)',
          '- Investeeri pikalt (5+ aastat)',
          '- Ära investeeri raha, mida lähiajal vajad',
          '',
          'Küsi konkreetse aktsia riski kohta — arvutan beta, volatiilsuse ja sektoripositsiooni.',
        ].join('\n');
      } else {
        reply = [
          'Olen Investor AI — küsi mis tahes investeerimisega seotud küsimus:',
          '',
          '• **Aktsia analüüs:** "Analüüsi NVDA" — P/E, PEG, õiglane hind',
          '• **Alustamine:** "Kuidas alustada investeerimist?"',
          '• **Portfell:** "Kuidas hajutada?"',
          '• **ETF-id:** "Mis on ETF?"',
          '• **Risk:** "Kui riskantne on TSLA?"',
          '• **Võrdlus:** "NVDA vs AMD"',
          '',
          'Küsi julgelt!',
        ].join('\n');
      }
      mode = 'local';
    }

    return NextResponse.json({
      reply: decodeEntities(reply),
      mode,
      ...(openaiError && mode !== 'openai' ? { warning: openaiError } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
