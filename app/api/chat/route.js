import { NextResponse } from 'next/server';
import { getQuotes } from '../../../lib/yahoo';
import { getTrendNews } from '../../../lib/newsRss';

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
  if (/kas .*mõtet|kas .*tasub|kas .*invest|osta|müü|veel invest|sisse panna|positsioon/.test(t)) {
    return 'invest';
  }
  if (/mis on|mis fond|selgita|tutvusta/.test(t)) return 'explain';
  if (/räägi|lähemalt|rohkem|detail|täpsusta|selgita (veel|lähemalt)/.test(t)) return 'deepen';
  if (/hind|kui palju|muutus|tõus|langus|performance|tootlus/.test(t)) return 'price';
  return 'general';
}

function isFollowUp(q) {
  const t = q.toLowerCase().trim();
  if (t.length < 80 && /^(ja|aga|ok|okei|selge|jah|ei|miks|kuidas|millal|kas)\b/.test(t)) return true;
  if (/sellest|seda|selle|nende|temast|selles|eelmis|mainitud|üllal|ülemise|sama|lähemalt|rohkem|täpsusta|jätka|räägi (veel|lähemalt|rohkem)/.test(t)) {
    return true;
  }
  if (t.split(/\s+/).length <= 6 && !extractSymbols(t).length) return true;
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

function buildSystemPrompt(prefs, marketLines) {
  const focus = FOCUS_LABELS[prefs?.focus] || FOCUS_LABELS.market;
  const market = marketLines.length
    ? `\nReaalajas andmed (kasuta ainult kui asjakohane):\n${marketLines.join('\n')}`
    : '';

  return `Sa oled Investor AI — professionaalne investeerimisassistent eesti keeles, stiililt nagu Claude.

REEGLID:
1. See on JÄTKUV VESTLUS. Kasuta kogu eelnevat sõnumilugu. Kui kasutaja ütleb „sellest“, „lähemalt“, „miks“ vms, jätka viimast teemat/sümbolit — ära küsi uuesti, mida ta juba mainis.
2. Vasta TÄPSELT kasutaja küsimusele. Crypto küsimustele vasta crypto loogikaga (mitte “üksikaktsia risk” malliga). Kui küsitakse “kõige riskantsem crypto”, erista meme/mikro/alt vs BTC/ETH.
3. Kui mainitakse sümbolit (nt SMH), räägi sellest konkreetselt.
4. Ära korda küsimust. Ära kasuta malle ega „Sinu küsimus:”.
5. Ära kleebi juhuslikke uudiste pealkirju ilma seoseta.
6. Ole aus ja tasakaalukas; ära anna kindlat osta/müü käsku.
7. Ära leiuta hindu ega uudiseid. Kui andmeid napib, ütle otse.
8. Fookusevihje (ainult kui aitab): ${focus}.${market}

PIKKUS JA STRUKTUUR (eriti esimesele “kas investeerida / kas mõtet” küsimusele):
Kirjuta PIKK, Claude’i-stiilis analüüs (umbes 350–550 sõna), mitte 3–4 lauset.
Kasuta pealkirju:
**Argumendid POOLT**
**Argumendid VASTU / riskid**
**Minu tegelik vastus**
Iga plokk 4–6 sisukat punkti või lõiku. Too sisse struktuuritrend, fundamentaalid, valuatsioon/risk, osakaal, horisont. Kui on uudiste pealkirju kontekstis, seo need analüüsiga (ära kleebi toorelt lõppu).`;
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
      max_tokens: 1800,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || 'OpenAI päring ebaõnnestus');
  }
  return data.choices?.[0]?.message?.content || '';
}

function priceLine(quote) {
  if (!quote) return null;
  const p = fmtPrice(quote.price);
  const pct = fmtPct(quote.changePercent);
  if (!p) return null;
  const name = quote.name && quote.name !== quote.symbol ? ` (${quote.name})` : '';
  return `${quote.symbol}${name}: $${p}${pct ? ` (${pct} täna)` : ''}`;
}

function answerInvest(sym, info, quote, headlines = []) {
  const name = info?.name || sym;
  const kind = info?.kind === 'etf' ? 'ETF' : 'aktsia';
  const price = priceLine(quote);
  const tracks = info?.tracks || 'konkreetset turu-/sektorilugu';
  const note = info?.note || '';
  const newsBits = (headlines || []).slice(0, 3).map((h) => decodeEntities(h)).filter(Boolean);

  const parts = [];

  parts.push(
    `Küsimus **${sym}** (${name}) kohta väärib tasakaalustatud pilti — mitte ühte “jah/ei” lauset. All on **POOLT**, **VASTU** ja siis **minu tegelik vastus**, et saaksid ise otsustada.`
  );

  parts.push('**Argumendid POOLT**');
  parts.push(
    [
      `• **Selge teema.** ${sym} on ${kind}, mis jälgib: ${tracks}. Kui see narratiiv (kasv, tehnoloogia, sektor) sul on pikaajaline, on fond/aktsia loogiline viis sellele panustada.`,
      `• **Struktuuritrend vs spekulatsioon.** Kui nõudlus tuleb suurettevõtete investeeringutest ja rahavoost (mitte ainult hype’ist), on tees tugevam kui 2000. a dot-com’is.`,
      note ? `• **Mida fond/aktsia ise ütleb.** ${note}` : `• **Hajutus ühe nime sees.** ${kind === 'ETF' ? 'ETF hajutab mitme nime peale — vähem üksikaktsiaõnnetust kui nt ainult NVDA.' : 'Üksikaktsia annab suurema upside’i, aga ka suurema idioriskiga.'}`,
      `• **Pikk horisont aitab.** 5–10 a vaates on sektori/kasvu lood ajalooliselt andnud tugevaid tootlusi — minevik ei ole garantii, aga see näitab, miks investorid ${sym}-d üldse kaaluvad.`,
      price ? `• **Praegune turg.** ${price} — kasuta seda taustaks, mitte ainsa ostusignaalina.` : `• **Hind.** Vaata Watchlistist värsket hinda enne otsust.`,
    ].join('\n')
  );

  parts.push('**Argumendid VASTU / riskid**');
  parts.push(
    [
      `• **Valuatsioon ja “hea uudis on juba hinnas”.** Pärast tugevat rallit võib järgmine positiivne pealkiri hinda vähem liigutada; ootuste langus teeb vastupidist.`,
      `• **Kontsentratsioon ja beeta.** ${kind === 'ETF' ? 'Kitsas sektorifond liigub turust enamasti tugevamini — kui tippnimed (nt NVDA jt) komistavad, tunnetab kogu korv seda.' : 'Üksikaktsia võib ühe uudisega −20…−40% teha.'}`,
      `• **Tsükkel ja meeleolu.** Pooljuhtide/AI lood on volatiilsed: kuude lõikes võivad tulla suured drawdown’id isegi kui pikaajaline tees jääb alles.`,
      `• **Ajahorisont.** Kui raha võib vaja minna 1–2 aasta jooksul, on ${sym} halb koht “parkimiseks”.`,
      `• **Osakaalu risk.** Kui ${sym} on juba suur tükk portfellist, lisamine suurendab kontsentratsiooni — isegi kui tees on õige.`,
    ].join('\n')
  );

  if (newsBits.length) {
    parts.push('**Mida uudised praegu taustaks annavad**');
    parts.push(
      [
        ...newsBits.map((h) => `• ${h}`),
        'Kasuta pealkirju kontekstina: need selgitavad *miks* turg täna räägib, mitte ei anna automaatset osta/müü signaali.',
      ].join('\n')
    );
  }

  parts.push('**Minu tegelik vastus**');
  parts.push(
    [
      `Lihtsat “jah” või “ei” ei ole. See sõltub sinu **horisondist**, **riskitaluvusest** ja sellest, kui palju AI/tech/sektorit sul juba portfellis on.`,
      `**Sobib pigem siis, kui:** (1) sul on juba lai baas (nt VOO/SPY/maailm), (2) ${sym} jääb satelliidiks (sageli ~5–15%), (3) talud −30…−50% sektori drawdown’i ilma sundmüügita, (4) lisad keskmistades, mitte “all-in”.`,
      `**Pigem ära / ära lisa, kui:** vajad raha varsti, ${sym} on juba liiga suur osakaal, või ostad ainult sellepärast et “kõik räägivad”.`,
      price ? `Hetke viide: ${price}.` : '',
      'Ma ei ole litsentseeritud nõustaja — see on analüüs otsuse toetuseks, mitte käsk osta või mitte osta.',
    ]
      .filter(Boolean)
      .join('\n\n')
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

function localReply({ messages, context, quotesBySym }) {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const q = last.trim();
  const followUp = isFollowUp(q);
  const historySymbols = symbolsFromHistory(messages);
  const currentSymbols = extractSymbols(q);
  const symbols = currentSymbols.length ? currentSymbols : historySymbols;
  const primary = symbols[0] || null;
  const info = primary ? KNOWN[primary] : null;
  const quote = primary ? quotesBySym[primary] : null;
  let intent = detectIntent(q);

  // Järgnev küsimus ilma sümbolita → jätka eelmise teemaga
  if (followUp && primary && (intent === 'general' || intent === 'deepen' || intent === 'explain')) {
    intent = 'deepen';
  }

  if (primary && intent === 'invest') {
    return answerInvest(primary, info || { name: primary }, quote, context?.headlines || []);
  }
  if (primary && intent === 'deepen') {
    // “Räägi lähemalt” → anna täispikk Claude-stiilis analüüs, mitte 3 lauset
    if (/lähemalt|rohkem|detail|täpsusta|räägi|sellest|seda/.test(q.toLowerCase())) {
      return answerInvest(primary, info || { name: primary }, quote, context?.headlines || []);
    }
    return answerDeepen(primary, info || { name: primary }, quote, lastAssistantSnippet(messages), q);
  }
  if (primary && intent === 'explain') return answerExplain(primary, info || { name: primary, kind: 'stock' }, quote);
  if (primary && intent === 'price') return answerPrice(primary, quote, info);
  if (intent === 'crypto') {
    return answerCryptoRisk(q);
  }
  if (intent === 'compare') {
    const pair = symbols.length >= 2 ? symbols : primary ? [primary, 'VOO'] : historySymbols;
    return answerCompare(pair, quotesBySym);
  }
  if (intent === 'risk') {
    if (!primary && !historySymbols[0]) {
      // “risk” ilma sümbolita — ära anna tühja aktsiamalli
      if (/crypto|krüpto|btc|eth/.test(q.toLowerCase())) return answerCryptoRisk(q);
      return [
        'Riskist rääkimiseks ütle **mis** (nt SMH, NVDA, BTC) või küsi otse: “milline crypto on kõige riskantsem?”.',
        'Üldiselt: kitsas sektor / üksiknimi / meme-crypto / leverage = kõrgem risk; lai indeks = madalam.',
      ].join('\n\n');
    }
    return answerRisk(primary || historySymbols[0], info || KNOWN[historySymbols[0]]);
  }
  if (intent === 'news') return answerNews(q, context?.headlines);

  if (primary) {
    return (
      answerExplain(primary, info || { name: quote?.name || primary, kind: 'stock' }, quote) +
      '\n\nKui tahad otsust “kas osta/juurde panna”, ütle horisont (nt 1 a / 5 a) ja soovitud osakaal — jätkan sealt.'
    );
  }

  if (/tervit|hei|tere|help|abi/.test(q.toLowerCase())) {
    return 'Tere — küsi vabalt, nt „kas SMH-sse on mõtet investeerida?”. Saame samas vestluses edasi minna (“räägi lähemalt”, “aga risk?” jne).';
  }

  // Kui on vestlusajalugu, ära lange tühja malli peale
  const prev = lastAssistantSnippet(messages);
  if (prev) {
    return `Sa ütlesid: “${q}”. Jään eelmise teema juurde — täpsusta palun üks asi: kas räägime **riskist**, **osakaalust**, **võrdlusest** (nt vs VOO) või **hinnaliikumisest**? Siis lähen otse sügavuti.`;
  }

  return `Küsi vabalt konkreetset sümbolit või teemat (nt SMH, VOO, risk). Saame sellest pikalt edasi vestelda.`;
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
    const symbols = [
      ...new Set([...extractSymbols(lastUser), ...symbolsFromHistory(normalized)]),
    ].slice(0, 4);

    let quotesBySym = {};
    if (symbols.length) {
      try {
        const quotes = await getQuotes(symbols);
        quotesBySym = Object.fromEntries((quotes || []).map((q) => [q.symbol, q]));
      } catch {
        quotesBySym = {};
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

    let system = buildSystemPrompt(prefs, marketLines);
    if (context.headlines?.length) {
      system += `\n\nSeotud uudiste pealkirjad (kasuta ainult kui asjakohane, ära kleebi toorelt):\n${context.headlines
        .slice(0, 5)
        .map((h) => `• ${h}`)
        .join('\n')}`;
    }

    let reply = null;
    let mode = 'local';
    let openaiError = null;

    try {
      reply = await callOpenAI({ system, messages: normalized });
      if (reply) mode = 'openai';
    } catch (e) {
      openaiError = e.message || 'OpenAI viga';
    }

    if (!reply) {
      reply = localReply({ messages: normalized, context, quotesBySym });
      mode = openaiError ? 'local_fallback' : 'local';
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
