/**
 * Lihtsustatud valuatsioonimudel: P/E, PEG, P/B, dividend, 52W.
 * Ei ole finantsnõustamine — ainult arvutuslik hinnang.
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fmt(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function isFundLike(quoteType) {
  const t = String(quoteType || '').toUpperCase();
  return t === 'ETF' || t === 'MUTUALFUND' || t === 'INDEX';
}

/** Kasvuprofiil → mõistlik P/E bänd */
function peBand({ earningsGrowth, revenueGrowth, pegRatio }) {
  const g = earningsGrowth ?? revenueGrowth;
  // Kasv % (Yahoo annab 0.15 = 15%)
  const growthPct = g != null ? (Math.abs(g) > 1 ? g : g * 100) : null;

  if (pegRatio != null && pegRatio > 0) {
    // PEG ~1 → pe ≈ growth%; kasuta 0.8–1.2× growth kui growth teada
    if (growthPct != null && growthPct > 0) {
      return { peLow: growthPct * 0.8, peHigh: growthPct * 1.2, basis: 'peg' };
    }
  }

  if (growthPct != null && growthPct >= 20) {
    return { peLow: 22, peHigh: 32, basis: 'growth' };
  }
  if (growthPct != null && growthPct >= 8) {
    return { peLow: 14, peHigh: 22, basis: 'blend' };
  }
  if (growthPct != null && growthPct < 0) {
    return { peLow: 8, peHigh: 14, basis: 'decline' };
  }
  return { peLow: 12, peHigh: 18, basis: 'value' };
}

function scoreFromPe(pe, peLow, peHigh) {
  if (pe == null || pe <= 0) return null;
  const mid = (peLow + peHigh) / 2;
  // Madalam P/E → kõrgem skoor
  if (pe <= peLow) return clamp(85 + ((peLow - pe) / peLow) * 15, 70, 100);
  if (pe >= peHigh) return clamp(40 - ((pe - peHigh) / peHigh) * 40, 5, 45);
  // Lineaarne peLow→100-ish, peHigh→45
  const t = (pe - peLow) / (peHigh - peLow);
  return clamp(90 - t * 45, 45, 90);
}

function scoreFromPeg(peg) {
  if (peg == null || peg <= 0) return null;
  if (peg < 0.8) return clamp(95 - peg * 10, 80, 100);
  if (peg <= 1.2) return clamp(80 - (peg - 0.8) * 50, 60, 80);
  if (peg <= 2) return clamp(55 - (peg - 1.2) * 40, 25, 55);
  return clamp(25 - (peg - 2) * 8, 5, 25);
}

function scoreFromPb(pb) {
  if (pb == null || pb <= 0) return null;
  if (pb < 1) return 90;
  if (pb < 2) return 75;
  if (pb < 4) return 55;
  if (pb < 8) return 35;
  return 20;
}

function scoreFromYield(yld) {
  if (yld == null) return null;
  // Yahoo: 0.02 = 2% või juba protsent
  const pct = Math.abs(yld) > 1 ? yld : yld * 100;
  if (pct <= 0) return 45;
  if (pct < 1) return 50;
  if (pct < 2.5) return 65;
  if (pct < 5) return 75;
  return 70; // väga kõrge yield võib olla risk
}

function scoreFrom52w(price, low, high) {
  if (price == null || low == null || high == null || high <= low) return null;
  const pos = (price - low) / (high - low); // 0 = põhjas, 1 = tipus
  // Kerge eelistus madalama 52W positsiooni suunas (mitte äärmuslik mean-reversion)
  if (pos < 0.25) return 75;
  if (pos < 0.5) return 65;
  if (pos < 0.75) return 50;
  return 35;
}

function scoreFromBeta(beta) {
  if (beta == null) return null;
  if (beta < 0.8) return 70;
  if (beta <= 1.2) return 60;
  if (beta <= 1.6) return 45;
  return 30;
}

function labelFromScore(score) {
  if (score == null) return 'unknown';
  if (score >= 68) return 'cheap';
  if (score >= 45) return 'fair';
  return 'expensive';
}

const LABEL_ET = {
  cheap: 'Odavam',
  fair: 'Õiglane',
  expensive: 'Kallim',
  unknown: 'Andmeid napib',
};

/**
 * @param {object} input
 * @returns {object} valuation result
 */
export function computeValuation(input) {
  const price = num(input.price);
  const pe = num(input.pe);
  const forwardPE = num(input.forwardPE);
  const pegRatio = num(input.pegRatio);
  const priceToBook = num(input.priceToBook);
  const bookValue = num(input.bookValue);
  const eps = num(input.eps);
  const yieldRaw = num(input.yield);
  const beta = num(input.beta);
  const fiftyTwoWeekHigh = num(input.fiftyTwoWeekHigh);
  const fiftyTwoWeekLow = num(input.fiftyTwoWeekLow);
  const earningsGrowth = num(input.earningsGrowth);
  const revenueGrowth = num(input.revenueGrowth);
  const profitMargins = num(input.profitMargins);
  const quoteType = input.quoteType || null;
  const sector = input.sector || null;
  const industry = input.industry || null;

  if (isFundLike(quoteType)) {
    return {
      score: null,
      label: 'unknown',
      labelEt: 'ETF / fond',
      fairLow: null,
      fairHigh: null,
      fairMid: null,
      upsidePct: null,
      confidence: 'low',
      reasons: [
        'See on ETF või fond — üksikaktsia P/E / EPS mudel ei sobi.',
        'Hinda fond’i kulukust, jälgitavat indeksit ja oma riskitaluvust eraldi.',
      ],
      factors: {},
      band: null,
    };
  }

  const band = peBand({ earningsGrowth, revenueGrowth, pegRatio });
  const reasons = [];
  const factors = {};

  // --- õiglane hind ---
  let fairLow = null;
  let fairHigh = null;
  if (eps != null && eps > 0) {
    fairLow = eps * band.peLow;
    fairHigh = eps * band.peHigh;
    reasons.push(
      `Õiglane hind ≈ EPS ${fmt(eps)} × P/E ${fmt(band.peLow, 0)}–${fmt(band.peHigh, 0)} → $${fmt(fairLow)}–$${fmt(fairHigh)} (${band.basis}).`
    );
  } else if (bookValue != null && bookValue > 0) {
    fairLow = bookValue * 1.0;
    fairHigh = bookValue * 2.5;
    reasons.push(
      `EPS puudub — õiglane hind book value’ist: ${fmt(bookValue)} × 1.0–2.5 P/B → $${fmt(fairLow)}–$${fmt(fairHigh)}.`
    );
  }

  const fairMid = fairLow != null && fairHigh != null ? (fairLow + fairHigh) / 2 : null;
  const upsidePct =
    fairMid != null && price != null && price > 0 ? ((fairMid - price) / price) * 100 : null;

  // --- faktorite skoorid ---
  const peScore = scoreFromPe(pe ?? forwardPE, band.peLow, band.peHigh);
  if (peScore != null) {
    factors.pe = { score: peScore, value: pe ?? forwardPE, weight: 0.35 };
    const used = pe != null ? 'trailing P/E' : 'forward P/E';
    reasons.push(
      `${used} ${fmt(pe ?? forwardPE)} vs mõistlik bänd ${fmt(band.peLow, 0)}–${fmt(band.peHigh, 0)} → skoor ${Math.round(peScore)}.`
    );
  }

  const pegScore = scoreFromPeg(pegRatio);
  if (pegScore != null) {
    factors.peg = { score: pegScore, value: pegRatio, weight: 0.25 };
    const tip =
      pegRatio < 1 ? 'alla 1 (kasv suhteliselt odav)' : pegRatio <= 1.5 ? 'umbes õiglane' : 'üle 1.5 (kasvu eest makstakse palju)';
    reasons.push(`PEG ${fmt(pegRatio)} — ${tip} → skoor ${Math.round(pegScore)}.`);
  }

  const pbScore = scoreFromPb(priceToBook);
  if (pbScore != null) {
    factors.pb = { score: pbScore, value: priceToBook, weight: 0.15 };
    reasons.push(`P/B ${fmt(priceToBook)} → skoor ${Math.round(pbScore)}.`);
  }

  const yScore = scoreFromYield(yieldRaw);
  if (yScore != null && yieldRaw != null && yieldRaw > 0) {
    factors.yield = { score: yScore, value: yieldRaw, weight: 0.1 };
    const pct = Math.abs(yieldRaw) > 1 ? yieldRaw : yieldRaw * 100;
    reasons.push(`Dividenditootlus ${fmt(pct, 1)}% → skoor ${Math.round(yScore)}.`);
  }

  const w52 = scoreFrom52w(price, fiftyTwoWeekLow, fiftyTwoWeekHigh);
  if (w52 != null) {
    factors.w52 = { score: w52, value: price, weight: 0.1 };
    const pos =
      fiftyTwoWeekHigh > fiftyTwoWeekLow
        ? ((price - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow)) * 100
        : null;
    reasons.push(`52 nädala vahemikus positsioon ~${fmt(pos, 0)}% (madalam = suhteliselt odavam) → skoor ${Math.round(w52)}.`);
  }

  const bScore = scoreFromBeta(beta);
  if (bScore != null) {
    factors.beta = { score: bScore, value: beta, weight: 0.05 };
  }

  if (profitMargins != null) {
    const mPct = Math.abs(profitMargins) > 1 ? profitMargins : profitMargins * 100;
    if (mPct > 20) reasons.push(`Kasummarginaal ${fmt(mPct, 1)}% on tugev — toetab kõrgemat valuatsiooni.`);
    else if (mPct < 5) reasons.push(`Kasummarginaal ${fmt(mPct, 1)}% on õhuke — vähem ruumi veale.`);
  }

  if (upsidePct != null) {
    reasons.push(
      upsidePct >= 10
        ? `Praegune hind $${fmt(price)} on ~${fmtPct(upsidePct)} allpool mudeli keskpunkti.`
        : upsidePct <= -10
          ? `Praegune hind $${fmt(price)} on ~${fmtPct(Math.abs(upsidePct))} üle mudeli keskpunkti.`
          : `Praegune hind $${fmt(price)} on mudeli vahemiku lähedal (${fmtPct(upsidePct)}).`
    );
  }

  // Kaalutud skoor
  const entries = Object.values(factors);
  let score = null;
  let confidence = 'low';
  if (entries.length > 0) {
    const totalW = entries.reduce((s, f) => s + f.weight, 0);
    score = entries.reduce((s, f) => s + f.score * (f.weight / totalW), 0);
    score = Math.round(clamp(score, 0, 100));
    if (entries.length >= 4) confidence = 'high';
    else if (entries.length >= 2) confidence = 'medium';
  }

  if (score == null) {
    reasons.unshift('Fundamentaalid puuduvad või on puudulikud — skoori ei saa usaldusväärselt arvutada.');
  }

  const label = labelFromScore(score);

  // Tippinvestorite klassikalised filtrid (Graham / Lynch / Buffett)
  const gurus = buildGuruChecks({
    pe,
    priceToBook,
    pegRatio,
    price,
    eps,
    earningsGrowth,
  });

  return {
    score,
    label,
    labelEt: LABEL_ET[label],
    fairLow,
    fairHigh,
    fairMid,
    upsidePct,
    confidence,
    reasons: reasons.slice(0, 6),
    factors,
    band,
    sector,
    industry,
    gurus,
  };
}

function buildGuruChecks({ pe, priceToBook, pegRatio, price, eps, earningsGrowth }) {
  const checks = [];

  // Benjamin Graham: P/E ≤ 15, P/B ≤ 1.5, P/E × P/B ≤ 22.5
  if (pe != null && pe > 0) {
    const peOk = pe <= 15;
    checks.push({
      guru: 'Benjamin Graham',
      rule: 'Defensiivne P/E ≤ 15',
      value: pe,
      pass: peOk,
      detail: peOk
        ? `Trailing P/E ${fmt(pe)} jääb Grahami ≤15 piiri sisse (margin of safety).`
        : `Trailing P/E ${fmt(pe)} on üle Grahami ≤15 — klassikalise value-filtri järgi kallis.`,
    });
  }
  if (pe != null && priceToBook != null && pe > 0 && priceToBook > 0) {
    const product = pe * priceToBook;
    const ok = product <= 22.5;
    checks.push({
      guru: 'Benjamin Graham',
      rule: 'P/E × P/B ≤ 22.5',
      value: product,
      pass: ok,
      detail: ok
        ? `P/E×P/B = ${fmt(product)} ≤ 22.5 — Grahami kombineeritud odavuse test läbitud.`
        : `P/E×P/B = ${fmt(product)} > 22.5 — Graham nimetaks seda liiga kalliks (eriti asset-light tech puhul on see filter range).`,
    });
  }

  // Peter Lynch: PEG = P/E ÷ growth%; ≤1 odav, ~1 õiglane, >1.5 kallis
  let peg = pegRatio;
  if (peg == null && pe != null && pe > 0 && earningsGrowth != null) {
    const gPct = Math.abs(earningsGrowth) > 1 ? earningsGrowth : earningsGrowth * 100;
    if (gPct > 0) peg = pe / gPct;
  }
  if (peg != null && peg > 0) {
    const pass = peg <= 1;
    const fair = peg > 1 && peg <= 1.5;
    checks.push({
      guru: 'Peter Lynch',
      rule: 'PEG ≤ 1 (GARP)',
      value: peg,
      pass: pass || fair,
      detail: pass
        ? `PEG ${fmt(peg)} ≤ 1 — Lynch’i järgi kasv on hinnas odav (“growth at a reasonable price”).`
        : fair
          ? `PEG ${fmt(peg)} on 1–1.5 — Lynch’i skaalal umbes õiglane, mitte odav.`
          : `PEG ${fmt(peg)} > 1.5 — Lynch ütleks, et maksad kasvule liiga palju.`,
    });
  }

  // Warren Buffett (lihtsustatud): earnings yield = EPS/price ≈ 1/PE; võrdle ~ bond yield proxy 4–5%
  if (pe != null && pe > 0) {
    const ey = (1 / pe) * 100;
    const pass = ey >= 6;
    checks.push({
      guru: 'Warren Buffett',
      rule: 'Earnings yield vs “õiglane” (~6%+ stabiilsele ärile)',
      value: ey,
      detail: pass
        ? `Earnings yield ~${fmt(ey, 1)}% (1/P/E) — Buffetti lihtsas raamistikus konkurentsivõimeline vs pikaajaline võlakiri.`
        : `Earnings yield ~${fmt(ey, 1)}% — Buffett maksaks selle eest ainult siis, kui äri on erakordselt kvaliteetne (moat), mitte “odavuse” pärast.`,
      pass,
    });
  } else if (eps != null && price != null && price > 0 && eps > 0) {
    const ey = (eps / price) * 100;
    checks.push({
      guru: 'Warren Buffett',
      rule: 'Earnings yield = EPS / hind',
      value: ey,
      pass: ey >= 6,
      detail: `EPS/hind ≈ ${fmt(ey, 1)}%.`,
    });
  }

  return checks;
}

/** Tekstiblokk chati / UI jaoks */
export function formatValuationForChat(metrics, valuation) {
  if (!valuation) return '';
  const lines = [];
  const m = metrics || {};
  lines.push('=== ARVUTATUD VALUATSIOON (kasuta neid numbreid, ära leiuta) ===');
  if (m.price != null) lines.push(`Hind: $${fmt(m.price)}`);
  if (m.pe != null) lines.push(`Trailing P/E: ${fmt(m.pe)}`);
  if (m.forwardPE != null) lines.push(`Forward P/E: ${fmt(m.forwardPE)}`);
  if (m.pegRatio != null) lines.push(`PEG: ${fmt(m.pegRatio)}`);
  if (m.priceToBook != null) lines.push(`P/B: ${fmt(m.priceToBook)}`);
  if (m.eps != null) lines.push(`EPS: ${fmt(m.eps)}`);
  if (m.beta != null) lines.push(`Beta: ${fmt(m.beta)}`);
  if (m.yield != null) {
    const y = Math.abs(m.yield) > 1 ? m.yield : m.yield * 100;
    lines.push(`Dividenditootlus: ${fmt(y, 1)}%`);
  }
  if (valuation.score != null) {
    lines.push(`Meie skoor: ${valuation.score}/100 → ${valuation.labelEt}`);
  }
  if (valuation.fairLow != null && valuation.fairHigh != null) {
    lines.push(
      `Õiglane hind (EPS × P/E bänd): $${fmt(valuation.fairLow)} – $${fmt(valuation.fairHigh)}` +
        (valuation.upsidePct != null ? ` (upside ${fmtPct(valuation.upsidePct)})` : '')
    );
  }
  if (valuation.gurus?.length) {
    lines.push('Tippinvestorite filtrid:');
    for (const g of valuation.gurus) {
      lines.push(`- ${g.guru}: ${g.detail}`);
    }
  }
  if (valuation.reasons?.length) {
    lines.push('Arvutuste selgitus:');
    valuation.reasons.forEach((r) => lines.push(`- ${r}`));
  }
  return lines.join('\n');
}
