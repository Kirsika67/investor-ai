'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import AuthGate from './AuthGate';
import ClaudeChat from './ClaudeChat';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'VOO', 'QQQ', 'SPY'];
const RANGES = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'ALL'];

const NEWS_TOPIC_CHIPS = [
  { id: 'top', label: 'Top' },
  { id: 'markets', label: 'Markets' },
  { id: 'tech', label: 'Tech' },
  { id: 'ai', label: 'AI' },
  { id: 'semis', label: 'Semiconductors' },
  { id: 'etf', label: 'ETF / Fondid' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'economy', label: 'Economy / Fed' },
  { id: 'energy', label: 'Energy' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'europe', label: 'Europe' },
  { id: 'banking', label: 'Banks' },
];

const TREND_TOPIC_CHIPS = [
  { id: 'all', label: 'Kõik' },
  { id: 'up', label: 'Tipptõusjad' },
  { id: 'down', label: 'Langejad' },
  { id: 'active', label: 'Aktiivseimad' },
  { id: 'growth', label: 'Growth Tech' },
  { id: 'value', label: 'Undervalued Growth' },
  { id: 'smallcap', label: 'Small Cap Gainers' },
  { id: 'shorted', label: 'Most Shorted' },
  { id: 'news', label: 'Trendiuudised' },
];

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

function trendWhy(section, changePercent) {
  const pct = fmtPct(changePercent);
  if (section === 'growth') {
    return `Growth-tech nimekirjas (${pct}). Kasv on kõrge — ava, et arvutada kas P/E ja PEG on mõistlikud, mitte ainult kas hind liigub.`;
  }
  if (section === 'value') {
    return `Undervalued-growth nimekirjas (${pct}). Turg hindab kasvu odavamalt — ava P/E, PEG ja õiglane hind.`;
  }
  if (section === 'smallcap') {
    return `Small-cap tõusjate seas (${pct}). Väiksemad nimed liiguvad teravamalt — ava risk ja katalüsaator.`;
  }
  if (section === 'shorted') {
    return `Enim shortitud nimekirjas (${pct}). Palju vastaspositsioone — squeeze või fundamentaalne nõrkus. Ava enne kui reageerid.`;
  }
  if (section === 'up') {
    return `Päeva tipptõusjate seas (${pct}). Momentum toob raha ja pealkirju — ava, mis liikumist toidab.`;
  }
  if (section === 'down') {
    return `Päeva suurimate langejate seas (${pct}). Risk või võimalus — ava uudised ja valuatsioon enne otsust.`;
  }
  if (section === 'active') {
    return `Tänase kõige aktiivsemate seas (${pct}). Suur maht = turg on selles nimes fookuses.`;
  }
  return 'Uudistes esile kerkinud teema — ava, et lugeda miks see tähelepanu saab.';
}

function trendKicker(section) {
  return (
    {
      growth: 'Growth tech',
      value: 'Undervalued growth',
      smallcap: 'Small cap',
      shorted: 'Most shorted',
      up: 'Päeva tõusja',
      down: 'Päeva langeja',
      active: 'Kõige aktiivsem',
      news: 'Uudistes',
    }[section] || 'Turg'
  );
}

function renderSimpleMd(text) {
  return String(text || '').split('\n').map((line, i) => {
    const parts = [];
    const re = /(\*\*[^*]+\*\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<strong key={`${i}-${m.index}`}>{m[0].slice(2, -2)}</strong>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return <p key={i}>{parts.length ? parts : '\u00A0'}</p>;
  });
}

function fmtVol(n) {
  if (n == null) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(n);
}

function fmtCap(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e12) return `${(n / 1e12).toFixed(3)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(3)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return fmtPrice(n);
}

function fmtRatio(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(digits);
}

function fmtYield(n) {
  if (n == null || Number.isNaN(n)) return '—';
  // Yahoo dividendYield often 0.0094 = 0.94%
  const pct = n <= 1 ? n * 100 : n;
  return `${pct.toFixed(2)}%`;
}

function sortNews(items) {
  return [...(items || [])].sort((a, b) => {
    const tb = b.publishedAt || 0;
    const ta = a.publishedAt || 0;
    if (tb !== ta) return tb - ta;
    return String(b.time || '').localeCompare(String(a.time || ''));
  });
}

function timeAgo(raw) {
  if (!raw) return '';
  const iso =
    raw.length >= 15
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
      : raw;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Sparkline({ data, up }) {
  const w = 56;
  const h = 28;
  if (!data?.length) return <svg width={w} height={h} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="spark">
      <polyline fill="none" stroke={up ? '#30d158' : '#ff453a'} strokeWidth="1.6" points={pts} />
    </svg>
  );
}

function PriceChart({ points, up }) {
  const width = 720;
  const height = 280;
  const pad = 8;
  if (!points?.length) {
    return <div className="chart-empty">Chart laeb…</div>;
  }
  const vals = points.map((p) => p.price);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1 || 1)) * (width - pad * 2);
    const y = pad + (1 - (p.price - min) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  const color = up ? '#30d158' : '#ff453a';
  const yTicks = [max, (max + min) / 2, min];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="main-chart" preserveAspectRatio="none">
        {yTicks.map((t, i) => {
          const y = pad + (1 - (t - min) / span) * (height - pad * 2);
          return (
            <g key={i}>
              <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
            </g>
          );
        })}
        <polygon points={area} fill={color} opacity="0.12" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2.2" />
      </svg>
      <div className="chart-ylabels">
        {yTicks.map((t) => (
          <span key={t}>{fmtPrice(t)}</span>
        ))}
      </div>
    </div>
  );
}

export default function StocksApp() {
  const { user, displayName, signOut } = useAuth();
  const userId = user?.id;

  const [rows, setRows] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [selected, setSelected] = useState('AAPL');
  const [range, setRange] = useState('1D');
  const [chart, setChart] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [symbolNews, setSymbolNews] = useState([]);
  const [hotNews, setHotNews] = useState([]);
  const [newsTopic, setNewsTopic] = useState('top');
  const [newsTopics, setNewsTopics] = useState(NEWS_TOPIC_CHIPS);
  const [newsTopicLoading, setNewsTopicLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [trends, setTrends] = useState([]);
  const [trendType, setTrendType] = useState('all');
  const [trendTopics, setTrendTopics] = useState(TREND_TOPIC_CHIPS);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendDetail, setTrendDetail] = useState(null);
  const [trendInsight, setTrendInsight] = useState(null);
  const [trendInsightLoading, setTrendInsightLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState([]);
  const [adding, setAdding] = useState(false);
  const [flash, setFlash] = useState('');
  const searchRef = useRef(null);
  const searchTimer = useRef(null);
  const detailRef = useRef(null);
  const [topTab, setTopTab] = useState('desk');
  const [deskAsk, setDeskAsk] = useState('');
  const [analystSeed, setAnalystSeed] = useState('');
  const [marketTape, setMarketTape] = useState([]);

  const selectedQuote = quotes[selected];
  const up = (chart?.changePercent ?? selectedQuote?.changePercent ?? 0) >= 0;

  useEffect(() => {
    let cancelled = false;
    async function loadTape() {
      try {
        const res = await fetch(`/api/market?_=${Date.now()}`);
        const data = await res.json();
        if (cancelled) return;
        const items = (data.tape || []).filter((t) => t?.symbol && t.price != null);
        if (items.length) {
          setMarketTape(items);
          return;
        }
        // Fallback: build from movers if tape empty
        const movers = data.movers || {};
        const fallback = [
          ...(movers.gainers || []).slice(0, 8),
          ...(movers.losers || []).slice(0, 8),
          ...(movers.mostActive || []).slice(0, 6),
        ].filter((t) => t?.symbol);
        setMarketTape(fallback);
      } catch {
        if (!cancelled) setMarketTape([]);
      }
    }
    loadTape();
    const id = setInterval(loadTape, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const loadWatchlist = useCallback(async () => {
    if (!userId) return;
    setLoadingList(true);
    setError('');
    let { data, error: dbError } = await supabase
      .from('watchlist_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (dbError) {
      setError(dbError.message);
      data = DEFAULT_SYMBOLS.map((symbol) => ({ id: `local-${symbol}`, symbol }));
    }

    if (!data?.length) {
      await supabase.from('watchlist_items').insert(DEFAULT_SYMBOLS.map((symbol) => ({ symbol, user_id: userId })));
      const again = await supabase
        .from('watchlist_items')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      data = again.data || DEFAULT_SYMBOLS.map((symbol) => ({ id: `local-${symbol}`, symbol }));
    }

    const seen = new Set();
    const unique = [];
    for (const row of data) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      unique.push(row);
    }

    setRows(unique);
    setSelected((cur) => (unique.some((r) => r.symbol === cur) ? cur : unique[0]?.symbol || 'AAPL'));
    setLoadingList(false);

    // Anna chart/fundamentalsidele esimesena ruumi, siis täida watchlist hinnad
    await new Promise((r) => setTimeout(r, 1200));

    // Hinnad ükshaaval — väldib Yahoo 429 limiiti
    for (const row of unique) {
      try {
        const res = await fetch(`/api/quotes?symbols=${row.symbol}`);
        const json = await res.json();
        if (json.quotes?.[0]) {
          setQuotes((prev) => ({ ...prev, [json.quotes[0].symbol]: json.quotes[0] }));
        }
      } catch {
        // ignore
      }
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadWatchlist();
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'trends' || hash === 'news' || hash === 'ai') setTopTab(hash);
    }
  }, [userId, loadWatchlist]);

  // Automaatne värske info iga 90s (ainult valitud + watchlist hinnad rahulikult)
  useEffect(() => {
    const refreshQuotes = async () => {
      for (const row of rows) {
        try {
          const res = await fetch(`/api/quotes?symbols=${row.symbol}&_=${Date.now()}`);
          const json = await res.json();
          if (json.quotes?.[0]) {
            setQuotes((prev) => ({ ...prev, [json.quotes[0].symbol]: json.quotes[0] }));
          }
        } catch {
          // ignore
        }
      }
    };
    const id = setInterval(refreshQuotes, 90000);
    return () => clearInterval(id);
  }, [rows]);

  useEffect(() => {
    if (!selected) return undefined;
    const tick = async () => {
      try {
        const cRes = await fetch(`/api/chart?symbol=${selected}&range=${range}&_=${Date.now()}`);
        const c = await cRes.json();
        if (!c.error || c.price) setChart(c);
      } catch {
        // ignore
      }
    };
    const id = setInterval(tick, 45000);
    return () => clearInterval(id);
  }, [selected, range]);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/news?topic=${encodeURIComponent(newsTopic)}&_=${Date.now()}`);
        const json = await res.json();
        if (json.items?.length) setHotNews(sortNews(json.items));
        if (selected) {
          const nRes = await fetch(`/api/symbol-news?symbol=${selected}&_=${Date.now()}`);
          const n = await nRes.json();
          if (n.items?.length) setSymbolNews(sortNews(n.items));
        }
      } catch {
        // ignore
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [selected, newsTopic]);

  useEffect(() => {
    let cancelled = false;
    async function loadChart() {
      if (!selected) return;
      try {
        const cRes = await fetch(`/api/chart?symbol=${selected}&range=${range}`);
        const c = await cRes.json();
        if (cancelled) return;
        if (c.error && !c.price) setError(c.error);
        else {
          setError(c.warning ? `Yahoo ajutiselt aeglane — näitan viimast head infot` : '');
          setChart(c);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    loadChart();
    return () => {
      cancelled = true;
    };
  }, [selected, range]);

  useEffect(() => {
    let cancelled = false;
    async function loadAnalysis() {
      if (!selected) return;
      setAnalysisLoading(true);
      setAnalysis(null);
      try {
        const res = await fetch(`/api/analyze?symbol=${encodeURIComponent(selected)}`);
        const json = await res.json();
        if (!cancelled && !json.error) setAnalysis(json);
        else if (!cancelled && json.error) setAnalysis({ error: json.error });
      } catch (e) {
        if (!cancelled) setAnalysis({ error: e.message });
      }
      if (!cancelled) setAnalysisLoading(false);
    }
    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    async function loadSymbolNews() {
      if (!selected) return;
      setNewsLoading(true);
      setSymbolNews([]);
      try {
        const nRes = await fetch(`/api/symbol-news?symbol=${selected}&_=${Date.now()}`);
        const n = await nRes.json();
        if (!cancelled) setSymbolNews(sortNews(n.items || []));
      } catch {
        // ignore
      }
      if (!cancelled) setNewsLoading(false);
    }
    loadSymbolNews();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrends() {
      if (topTab !== 'trends' && trends.length) return;
      setTrendsLoading(true);
      try {
        const res = await fetch(`/api/trends?type=${encodeURIComponent(trendType)}&_=${Date.now()}`);
        const t = await res.json();
        if (cancelled) return;
        if (Array.isArray(t.topics) && t.topics.length) setTrendTopics(t.topics);

        const custom = t.movers?.custom || [];
        const customKind = t.movers?.customKind || 'active';
        const customTitle = t.movers?.customTitle || '';

        const mapped = [];
        if (trendType === 'all' || trendType === 'active') {
          mapped.push(
            ...(t.movers?.mostActive || []).slice(0, 8).map((m) => ({
              id: `active-${m.symbol}`,
              kind: 'active',
              section: 'active',
              symbol: m.symbol,
              name: m.name,
              price: m.price,
              changePercent: m.changePercent,
              text: `${m.symbol} aktiivne · ${fmtPct(m.changePercent)}`,
              why: trendWhy('active', m.changePercent),
            }))
          );
        }
        if (trendType === 'all' || trendType === 'up') {
          mapped.push(
            ...(t.movers?.gainers || []).slice(0, 8).map((m) => ({
              id: `up-${m.symbol}`,
              kind: 'up',
              section: 'up',
              symbol: m.symbol,
              name: m.name,
              price: m.price,
              changePercent: m.changePercent,
              text: `↑ ${m.symbol} ${fmtPct(m.changePercent)}`,
              why: trendWhy('up', m.changePercent),
            }))
          );
        }
        if (trendType === 'all' || trendType === 'down') {
          mapped.push(
            ...(t.movers?.losers || []).slice(0, 8).map((m) => ({
              id: `down-${m.symbol}`,
              kind: 'down',
              section: 'down',
              symbol: m.symbol,
              name: m.name,
              price: m.price,
              changePercent: m.changePercent,
              text: `↓ ${m.symbol} ${fmtPct(m.changePercent)}`,
              why: trendWhy('down', m.changePercent),
            }))
          );
        }
        if (custom.length && !['all', 'up', 'down', 'active', 'news'].includes(trendType)) {
          mapped.push(
            ...custom.slice(0, 10).map((m) => ({
              id: `${trendType}-${m.symbol}`,
              kind: trendType,
              section: trendType,
              sectionTitle: customTitle,
              symbol: m.symbol,
              name: m.name,
              price: m.price,
              changePercent: m.changePercent,
              text: `${m.symbol} · ${fmtPct(m.changePercent)}`,
              why: trendWhy(trendType, m.changePercent),
            }))
          );
        }
        if (trendType === 'all' || trendType === 'news') {
          mapped.push(
            ...(t.trendNews?.items || []).slice(0, 8).map((item) => ({
              id: `news-${item.url || item.title}`,
              kind: 'news',
              section: 'news',
              symbol: item.relatedSymbol,
              text: item.title,
              why: item.summary
                ? String(item.summary).slice(0, 160) + (item.summary.length > 160 ? '…' : '')
                : trendWhy('news'),
              url: item.url,
              source: item.source,
              time: item.time,
            }))
          );
        }
        setTrends(mapped);
      } catch {
        if (!cancelled) setTrends([]);
      }
      if (!cancelled) setTrendsLoading(false);
    }
    loadTrends();
    return () => {
      cancelled = true;
    };
  }, [trendType, topTab]);

  useEffect(() => {
    let cancelled = false;
    async function loadHotNews() {
      setNewsTopicLoading(true);
      try {
        const res = await fetch(`/api/news?topic=${encodeURIComponent(newsTopic)}&_=${Date.now()}`);
        const json = await res.json();
        if (cancelled) return;
        setHotNews(sortNews(json.items || []));
        if (Array.isArray(json.topics) && json.topics.length) {
          setNewsTopics(json.topics);
        }
      } catch {
        if (!cancelled) setHotNews([]);
      }
      if (!cancelled) setNewsTopicLoading(false);
    }
    loadHotNews();
    return () => {
      cancelled = true;
    };
  }, [newsTopic, topTab]);

  useEffect(() => {
    if (topTab !== 'watchlist') return;
    clearTimeout(searchTimer.current);
    if (query.trim().length < 1) {
      setSearchHits([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        setSearchHits(json.results || []);
      } catch {
        setSearchHits([]);
      }
    }, 150);
    return () => clearTimeout(searchTimer.current);
  }, [query, topTab]);

  function openSymbol(symbol, name = '') {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return;
    setSelected(sym);
    setQuery('');
    setSearchHits([]);
    const label = name || quotes[sym]?.name || '';
    setFlash(`${sym}${label ? ` · ${label}` : ''}`);
    setTimeout(() => setFlash(''), 2000);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (!quotes[sym] || quotes[sym].price == null) {
      fetch(`/api/quotes?symbols=${sym}`)
        .then((r) => r.json())
        .then((json) => {
          if (json.quotes?.[0]) {
            setQuotes((prev) => ({ ...prev, [sym]: json.quotes[0] }));
          } else if (name) {
            setQuotes((prev) => ({
              ...prev,
              [sym]: { ...(prev[sym] || {}), symbol: sym, name, spark: prev[sym]?.spark || [] },
            }));
          }
        })
        .catch(() => {});
    } else if (name && !quotes[sym]?.name) {
      setQuotes((prev) => ({ ...prev, [sym]: { ...prev[sym], name } }));
    }
  }

  async function addToWatchlist(symbol) {
    const sym = String(symbol || selected || '').trim().toUpperCase();
    if (!sym || adding || !userId) return;
    if (rows.some((r) => r.symbol === sym)) {
      setFlash(`${sym} on juba watchlistis`);
      setTimeout(() => setFlash(''), 2000);
      return;
    }

    setAdding(true);
    const temp = { id: `temp-${sym}`, symbol: sym };
    setRows((prev) => [...prev, temp]);
    setFlash(`Lisatud watchlisti: ${sym}`);
    setTimeout(() => setFlash(''), 2500);

    const { data, error: dbError } = await supabase
      .from('watchlist_items')
      .insert({ symbol: sym, user_id: userId })
      .select()
      .single();

    if (dbError) {
      setRows((prev) => prev.filter((r) => r.id !== temp.id));
      setError('Salvestamine ebaõnnestus: ' + dbError.message);
      setAdding(false);
      return;
    }

    setRows((prev) => prev.map((r) => (r.id === temp.id ? data : r)));
    setError('');
    setAdding(false);

    try {
      const res = await fetch(`/api/quotes?symbols=${sym}`);
      const json = await res.json();
      if (json.quotes?.[0]) {
        setQuotes((prev) => ({ ...prev, [sym]: json.quotes[0] }));
      }
    } catch {
      // ignore
    }
  }

  async function removeSelected() {
    const row = rows.find((r) => r.symbol === selected);
    if (!row) return;
    const sym = selected;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    // Jääme sama aktsia juurde — nupp muutub "Add to Watchlist"
    setFlash(`Eemaldatud watchlistist: ${sym}`);
    setTimeout(() => setFlash(''), 2000);
    if (!String(row.id).startsWith('local-') && !String(row.id).startsWith('temp-')) {
      await supabase.from('watchlist_items').delete().eq('id', row.id).eq('user_id', userId);
    }
  }

  const list = useMemo(() => rows, [rows]);

  const trendSections = useMemo(() => {
    const titles = {
      up: 'Päeva tipptõusjad',
      down: 'Päeva suurimad langejad',
      active: 'Kõige aktiivsemad',
      news: 'Trendiuudised',
      growth: 'Growth technology',
      value: 'Undervalued growth',
      smallcap: 'Small cap gainers',
      shorted: 'Most shorted stocks',
    };
    const order =
      trendType === 'all'
        ? ['up', 'down', 'active', 'news']
        : [trendType];

    return order
      .map((section) => {
        const items = trends.filter((t) => (t.section || t.kind) === section);
        const title = items[0]?.sectionTitle || titles[section] || section;
        return { kind: section, title, items };
      })
      .filter((sec) => sec.items.length > 0);
  }, [trends, trendType]);

  async function openTrendDetail(item) {
    if (!item?.symbol && item?.kind === 'news' && item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!item?.symbol) return;
    setTrendDetail(item);
    setTrendInsight(null);
    setTrendInsightLoading(true);
    try {
      const qs = new URLSearchParams({
        symbol: item.symbol,
        kind: item.section || item.kind || 'active',
        changePercent: String(item.changePercent ?? ''),
        _: String(Date.now()),
      });
      const res = await fetch(`/api/trend-insight?${qs}`);
      const data = await res.json();
      setTrendInsight(data.error ? { analysis: data.error, news: [], blurb: item.why } : data);
    } catch (e) {
      setTrendInsight({ analysis: e.message, news: [], blurb: item.why });
    }
    setTrendInsightLoading(false);
  }

  function askAnalyst(text) {
    const q = String(text || '').trim();
    if (!q) return;
    setAnalystSeed(q);
    setTopTab('ai');
  }

  const watchlistRows = (
    <>
      {loadingList && <div className="side-empty">Laen…</div>}
      {!loadingList &&
        list.map((row) => {
          const q = quotes[row.symbol];
          const isUp = (q?.changePercent || 0) >= 0;
          const active = row.symbol === selected;
          return (
            <button
              key={row.id}
              type="button"
              className={`wl-row ${active ? 'active' : ''}`}
              onClick={() => openSymbol(row.symbol, q?.name || '')}
            >
              <div className="side-left">
                <div className="side-sym">{row.symbol}</div>
                <div className="side-name">{q?.name || '—'}</div>
              </div>
              <Sparkline data={q?.spark} up={isUp} />
              <div className="side-right">
                <div className="side-price">{fmtPrice(q?.price)}</div>
                <div className={`side-pill ${isUp ? 'up' : 'down'}`}>{fmtPct(q?.changePercent)}</div>
              </div>
            </button>
          );
        })}
    </>
  );

  return (
    <AuthGate>
    <div className="stocks-shell">
      <header className="stocks-topnav">
        <span className="topnav-brand">Desk</span>
        <nav className="topnav-tabs">
          <button type="button" className={topTab === 'desk' ? 'active' : ''} onClick={() => setTopTab('desk')}>
            Desk
          </button>
          <button
            type="button"
            className={topTab === 'watchlist' ? 'active' : ''}
            onClick={() => {
              setTopTab('watchlist');
              setTimeout(() => searchRef.current?.focus(), 50);
            }}
          >
            Raamat
          </button>
          <button type="button" className={topTab === 'news' ? 'active' : ''} onClick={() => setTopTab('news')}>
            Uudised
          </button>
          <button
            type="button"
            className={topTab === 'trends' ? 'active' : ''}
            onClick={() => {
              setTopTab('trends');
              setTrendDetail(null);
              setTrendInsight(null);
            }}
          >
            Turud
          </button>
          <button type="button" className={topTab === 'ai' ? 'active' : ''} onClick={() => setTopTab('ai')}>
            Analüütik
          </button>
        </nav>
        <div className="topnav-user">
          <span className="topnav-user-name">{displayName}</span>
          <button type="button" className="topnav-signout" onClick={() => signOut()}>
            Välju
          </button>
        </div>
      </header>

      <div className="market-tape" aria-label="Aktsiate tõusud ja langused">
          <div className="market-tape-track">
            {(marketTape.length ? [...marketTape, ...marketTape] : [{ symbol: '…', price: null, changePercent: 0 }]).map(
              (t, i) => {
                const isUp = (t.changePercent || 0) >= 0;
                const clickable = t.symbol && t.symbol !== '…' && t.price != null;
                return (
                  <button
                    key={`${t.symbol}-${i}`}
                    type="button"
                    className="market-tape-item"
                    disabled={!clickable}
                    onClick={() => {
                      if (!clickable) return;
                      setTopTab('watchlist');
                      openSymbol(t.symbol);
                    }}
                  >
                    <span className="market-tape-sym">{t.symbol}</span>
                    {t.price != null && <span className="market-tape-price">{fmtPrice(t.price)}</span>}
                    {t.price != null && (
                      <span className={`market-tape-pct ${isUp ? 'up' : 'down'}`}>{fmtPct(t.changePercent)}</span>
                    )}
                    {t.price == null && <span className="market-tape-pct">Laen turu tickerit…</span>}
                  </button>
                );
              }
            )}
          </div>
        </div>

      <div className="stocks-page">
        {topTab === 'desk' && (
          <div className="desk-home">
            <div className="desk-hero">
              <h1>Täna: kas hind on mõistlik?</h1>
              <p>
                Kirjuta sümbol või küsimus. Analüütik arvutab P/E, PEG, õiglase hinna ja
                võrdleb Grahami, Lynchi ja Buffetti filtritega — mitte jutumulliga.
              </p>
            </div>
            <form
              className="desk-ask"
              onSubmit={(e) => {
                e.preventDefault();
                askAnalyst(deskAsk || 'Analüüsi AAPL');
              }}
            >
              <input
                value={deskAsk}
                onChange={(e) => setDeskAsk(e.target.value)}
                placeholder="Analüüsi NVDA — kas P/E on mõistlik?"
              />
              <button type="submit">Arvuta</button>
            </form>
            <div className="desk-chips">
              {['Analüüsi AMD', 'Analüüsi NVDA', 'Kas VOO on mõistlik tuum?', 'Võrdle QQQ vs SMH'].map((c) => (
                <button key={c} type="button" className="desk-chip" onClick={() => askAnalyst(c)}>
                  {c}
                </button>
              ))}
            </div>
            <div className="desk-grid">
              <div className="desk-card">
                <h3>Sinu raamat</h3>
                <div className="desk-names">
                  {(list.length ? list : DEFAULT_SYMBOLS.map((s) => ({ id: s, symbol: s }))).slice(0, 6).map((row) => {
                    const q = quotes[row.symbol];
                    const isUp = (q?.changePercent || 0) >= 0;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        className="desk-name"
                        onClick={() => {
                          setTopTab('watchlist');
                          openSymbol(row.symbol, q?.name || '');
                        }}
                      >
                        <b>{row.symbol}</b>
                        <span className={isUp ? 'up' : 'down'}>{fmtPct(q?.changePercent)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="desk-card">
                <h3>Kuidas desk mõtleb</h3>
                <p className="muted">
                  Graham: P/E ≤ 15 ja P/E×P/B ≤ 22.5. Lynch: PEG ≤ 1 on kasv odavalt.
                  Buffett: earnings yield (1/P/E) peab konkureerima võlakirjaga, kui moat on nõrk.
                </p>
                <button type="button" className="analyze-btn" onClick={() => setTopTab('watchlist')}>
                  Ava raamat →
                </button>
              </div>
            </div>
          </div>
        )}

        {topTab === 'watchlist' && (
          <div className="watchlist-full">
            <div className="wl-head">
              <div>
                <div className="side-kicker">Raamat</div>
                <h1>Jälgimisnimekiri</h1>
              </div>
              <button
                type="button"
                className="add-btn"
                onClick={() => searchRef.current?.focus()}
                title="Lisa"
              >
                +
              </button>
            </div>

            <div className="wl-search-wrap">
              <input
                ref={searchRef}
                className="wl-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (searchHits[0]?.symbol || query.trim())) {
                    e.preventDefault();
                    const hit = searchHits[0];
                    openSymbol(hit?.symbol || query.trim(), hit?.name || '');
                  }
                }}
                placeholder="Otsi aktsiat või fondi…"
                autoComplete="off"
              />
              {query.trim() && (
                <div className="wl-suggest">
                  {searchHits.map((hit) => (
                    <button
                      key={hit.symbol}
                      type="button"
                      className="search-hit"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openSymbol(hit.symbol, hit.name);
                      }}
                    >
                      <b>{hit.symbol}</b>
                      <span>{hit.name}</span>
                      <em>{hit.type}</em>
                    </button>
                  ))}
                  {!searchHits.length && (
                    <button
                      type="button"
                      className="search-hit"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openSymbol(query.trim());
                      }}
                    >
                      Vaata <b>{query.trim().toUpperCase()}</b>
                    </button>
                  )}
                </div>
              )}
            </div>

            {flash && <div className="wl-flash">{flash}</div>}

            <div className="wl-list">{watchlistRows}</div>

            <div className="wl-foot">
              <span>Desk</span>
              <span className="dot">·</span>
              <span>{chart?.marketState === 'REGULAR' ? 'Market Open' : 'Market Closed'}</span>
            </div>

            {selected && (
              <section className="wl-detail" ref={detailRef} id="stock-detail">
                <header className="detail-head">
                  <div>
                    <div className="detail-title-row">
                      <h2>{chart?.symbol || selected}</h2>
                      <span className="detail-name">{chart?.name || selectedQuote?.name || ''}</span>
                    </div>
                    <div className="detail-sub">
                      {chart?.exchange || '—'} · {chart?.currency || 'USD'}
                    </div>
                  </div>
                  <div className="detail-price-block">
                    <div className="detail-price">{fmtPrice(chart?.price ?? selectedQuote?.price)}</div>
                    <div className={`detail-change ${up ? 'up' : 'down'}`}>
                      {fmtPrice(Math.abs(chart?.change ?? selectedQuote?.change ?? 0))} ({fmtPct(chart?.changePercent ?? selectedQuote?.changePercent)})
                    </div>
                    <div className="detail-actions">
                      {rows.some((r) => r.symbol === selected) ? (
                        <button type="button" className="ghost-btn" onClick={removeSelected}>
                          Eemalda
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="add-watchlist-btn"
                          onClick={() => addToWatchlist(selected)}
                          disabled={adding}
                        >
                          {adding ? 'Lisan…' : 'Add to Watchlist'}
                        </button>
                      )}
                    </div>
                  </div>
                </header>

                {error && <div className="stocks-error">{error}</div>}

                <div className="range-row">
                  {RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`range-btn ${range === r ? 'active' : ''}`}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <PriceChart points={chart?.points} up={up} />

                <div className="stats-grid">
                  <div className="stats-col">
                    <div><span>Open</span><b>{fmtPrice(chart?.open)}</b></div>
                    <div><span>High</span><b>{fmtPrice(chart?.high)}</b></div>
                    <div><span>Low</span><b>{fmtPrice(chart?.low)}</b></div>
                  </div>
                  <div className="stats-col">
                    <div><span>Vol</span><b>{fmtVol(chart?.volume)}</b></div>
                    <div><span>P/E</span><b>{fmtRatio(chart?.pe)}</b></div>
                    <div><span>Mkt Cap</span><b>{fmtCap(chart?.marketCap)}</b></div>
                  </div>
                  <div className="stats-col">
                    <div><span>52W H</span><b>{fmtPrice(chart?.fiftyTwoWeekHigh)}</b></div>
                    <div><span>52W L</span><b>{fmtPrice(chart?.fiftyTwoWeekLow)}</b></div>
                    <div><span>Avg Vol</span><b>{fmtVol(chart?.avgVolume)}</b></div>
                  </div>
                  <div className="stats-col">
                    <div><span>Yield</span><b>{fmtYield(chart?.yield)}</b></div>
                    <div><span>Beta</span><b>{fmtRatio(chart?.beta)}</b></div>
                    <div><span>EPS</span><b>{fmtRatio(chart?.eps)}</b></div>
                  </div>
                </div>
                {chart?.updatedAt && (
                  <div className="freshness">Uuendatud {new Date(chart.updatedAt).toLocaleTimeString('et-EE')}</div>
                )}

                <section className="valuation-section" aria-label="Valuatsioon">
                  <h3 className="panel-title">Kas on mõistlik?</h3>
                  {analysisLoading && <p className="muted">Arvutan valuatsiooni…</p>}
                  {!analysisLoading && analysis?.error && (
                    <p className="muted">Analüüsi ei saanud: {analysis.error}</p>
                  )}
                  {!analysisLoading && analysis?.valuation && (() => {
                    const v = analysis.valuation;
                    const m = analysis.metrics || {};
                    const labelClass =
                      v.label === 'cheap' ? 'cheap' : v.label === 'expensive' ? 'expensive' : v.label === 'fair' ? 'label-fair' : 'unknown';
                    return (
                      <>
                        <div className={`valuation-verdict valuation-${labelClass}`}>
                          <div className="valuation-verdict-main">
                            <span className="valuation-label">{v.labelEt}</span>
                            {v.score != null && (
                              <span className="valuation-score mono">{v.score}<small>/100</small></span>
                            )}
                          </div>
                          <div className="valuation-range">
                            {v.fairLow != null && v.fairHigh != null ? (
                              <>
                                <span>Õiglane hind</span>
                                <b className="mono">
                                  ${fmtPrice(v.fairLow)} – ${fmtPrice(v.fairHigh)}
                                </b>
                                {v.upsidePct != null && (
                                  <span className={`valuation-upside ${v.upsidePct >= 0 ? 'up' : 'down'}`}>
                                    {fmtPct(v.upsidePct)} vs praegune
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="muted">Õiglast hinda ei saa EPS/book puudumise tõttu arvutada</span>
                            )}
                          </div>
                        </div>
                        <div className="valuation-metrics">
                          <div><span>P/E</span><b className="mono">{fmtRatio(m.pe ?? m.forwardPE)}</b></div>
                          <div><span>PEG</span><b className="mono">{fmtRatio(m.pegRatio)}</b></div>
                          <div><span>P/B</span><b className="mono">{fmtRatio(m.priceToBook)}</b></div>
                          <div><span>EPS</span><b className="mono">{fmtRatio(m.eps)}</b></div>
                        </div>
                        {v.reasons?.length > 0 && (
                          <ul className="valuation-reasons">
                            {v.reasons.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        )}
                        {v.gurus?.length > 0 && (
                          <ul className="valuation-reasons valuation-gurus">
                            {v.gurus.map((g, i) => (
                              <li key={i}>
                                <strong>{g.guru}:</strong> {g.detail}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="valuation-disclaimer">
                          Lihtsustatud mudel (P/E, PEG, P/B, dividend, 52W) + Graham/Lynch/Buffett filtrid — ei ole ostu- ega müügisoovitus.
                          {v.confidence === 'low' ? ' Andmeid napib; skoor on vähem usaldusväärne.' : ''}
                        </p>
                        <button
                          type="button"
                          className="analyze-btn"
                          onClick={() => askAnalyst(`Analüüsi ${selected} — näita P/E, PEG, õiglast hinda ja Graham/Lynch/Buffett filtreid.`)}
                        >
                          Täispikk analüütiku memo
                        </button>
                      </>
                    );
                  })()}
                </section>

                <section className="symbol-news-section">
                  <h3 className="panel-title">News · {selected}</h3>
                  {newsLoading && <p className="muted">Laen {selected} uudiseid…</p>}
                  {!newsLoading && symbolNews.length === 0 && (
                    <p className="muted">Selle sümboli kohta uudiseid hetkel pole.</p>
                  )}
                  <div className="news-grid">
                    {symbolNews.slice(0, 9).map((item) => (
                      <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="news-card">
                        <div className="news-source">{item.source}</div>
                        <div className="news-card-title">{item.title}</div>
                        {item.summary && <div className="news-card-sum">{item.summary.slice(0, 120)}…</div>}
                        <div className="news-card-time">{timeAgo(item.time)}</div>
                      </a>
                    ))}
                  </div>
                </section>
              </section>
            )}
          </div>
        )}

        {topTab === 'news' && (
          <div className="page-panel">
            <h3 className="panel-title">News</h3>
            <p className="muted news-lead">Vali teema ülevalt — näed just selle ala uudiseid.</p>

            <div className="news-topics" role="tablist" aria-label="Uudiste teemad">
              {newsTopics.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={newsTopic === t.id}
                  className={`news-topic-chip ${newsTopic === t.id ? 'active' : ''}`}
                  onClick={() => setNewsTopic(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="news-grid">
              {newsTopicLoading && <p className="muted">Laen uudiseid…</p>}
              {!newsTopicLoading && hotNews.length === 0 && <p className="muted">Selle teema uudiseid pole hetkel.</p>}
              {!newsTopicLoading &&
                hotNews.slice(0, 18).map((item) => (
                  <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="news-card">
                    <div className="news-source">{item.source}</div>
                    <div className="news-card-title">{item.title}</div>
                    {item.summary && <div className="news-card-sum">{item.summary.slice(0, 120)}…</div>}
                    <div className="news-card-time">{timeAgo(item.time)}</div>
                  </a>
                ))}
            </div>
          </div>
        )}

        {topTab === 'trends' && (
          <div className="page-panel trends-page">
            {!trendDetail ? (
              <>
                <h3 className="panel-title">Trends</h3>
                <p className="muted trends-intro">
                  {trendType === 'growth'
                    ? 'Growth Tech = Yahoo kasvuaktsiad (NVDA jms). See ei ole päeva tõusjate nimekiri — täna võivad nad olla miinuses. % näitab tänast päeva, nimekiri näitab kasvutüüpi.'
                    : trendType === 'value'
                      ? 'Undervalued growth = kasv, mida turg odavamalt hindab. Tänane % võib olla plussis või miinuses.'
                      : 'Vali nimekiri ülevalt — klõpsa real, et avada uudised ja analüüs.'}
                </p>

                <div className="news-topics" role="tablist" aria-label="Trendide tüübid">
                  {trendTopics.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={trendType === t.id}
                      className={`news-topic-chip ${trendType === t.id ? 'active' : ''}`}
                      onClick={() => {
                        setTrendDetail(null);
                        setTrendType(t.id);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className="trends-panel">
                  {trendsLoading && <p className="muted">Laen trende…</p>}
                  {!trendsLoading && trends.length === 0 && (
                    <p className="muted">Trende ei õnnestunud laadida. Proovi uuesti.</p>
                  )}
                  {!trendsLoading &&
                    trendSections.map((sec) => (
                    <section key={sec.kind} className="trend-section">
                      <h4 className="trend-section-title">{sec.title}</h4>
                      <div className="trend-section-list">
                        {sec.items.map((t) => {
                          const isUp = (t.changePercent || 0) >= 0;
                          return (
                          <button
                            key={t.id}
                            type="button"
                            className="trend-card"
                            onClick={() => openTrendDetail(t)}
                          >
                            <div className="trend-card-top">
                              <div className="trend-card-left">
                                <span className="trend-card-sym">{t.symbol || t.text}</span>
                                {t.name && t.symbol && (
                                  <span className="trend-card-name">{t.name}</span>
                                )}
                              </div>
                              <div className="trend-card-right">
                                {t.changePercent != null && (
                                  <span className={`trend-card-pct mono ${isUp ? 'up' : 'down'}`}>
                                    {fmtPct(t.changePercent)}
                                  </span>
                                )}
                                {t.price != null && (
                                  <span className="trend-card-price mono">${fmtPrice(t.price)}</span>
                                )}
                              </div>
                            </div>
                            {t.why && <p className="trend-card-why">{t.why}</p>}
                            <span className="trend-card-cta">Ava analüüs →</span>
                          </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="trend-detail">
                <button
                  type="button"
                  className="trend-back"
                  onClick={() => {
                    setTrendDetail(null);
                    setTrendInsight(null);
                  }}
                >
                  ← Tagasi trendidesse
                </button>

                <div className="trend-detail-head">
                  <div>
                    <div className="side-kicker">{trendKicker(trendDetail.section || trendDetail.kind)}</div>
                    <h2>
                      {trendDetail.symbol}
                      {trendDetail.name ? ` · ${trendDetail.name}` : ''}
                    </h2>
                  </div>
                  <div className="trend-detail-stats">
                    {(trendInsight?.quote?.price ?? trendDetail.price) != null && (
                      <div className="mono">${fmtPrice(trendInsight?.quote?.price ?? trendDetail.price)}</div>
                    )}
                    <div
                      className={`mono ${
                        (trendInsight?.quote?.changePercent ?? trendDetail.changePercent ?? 0) >= 0 ? 'up' : 'down'
                      }`}
                    >
                      {fmtPct(trendInsight?.quote?.changePercent ?? trendDetail.changePercent)}
                    </div>
                  </div>
                </div>

                <p className="trend-detail-blurb">
                  {trendInsightLoading ? 'Laen selgitust…' : trendInsight?.blurb || trendDetail.why}
                </p>

                <div className="trend-detail-actions">
                  <button
                    type="button"
                    className="chip chip-active"
                    onClick={() => {
                      const sym = trendDetail.symbol;
                      setTrendDetail(null);
                      setTopTab('watchlist');
                      setTimeout(() => openSymbol(sym), 50);
                    }}
                  >
                    Ava Watchlistis
                  </button>
                </div>

                <h3 className="panel-title">AI analüüs — miks just see on kuum</h3>
                <div className="trend-analysis">
                  {trendInsightLoading && <p className="muted">AI kirjutab analüüsi…</p>}
                  {!trendInsightLoading && trendInsight?.analysis && renderSimpleMd(trendInsight.analysis)}
                </div>

                <h3 className="panel-title">Seotud uudised</h3>
                <div className="trend-news-list">
                  {trendInsightLoading && <p className="muted">Laen uudiseid…</p>}
                  {!trendInsightLoading && !(trendInsight?.news || []).length && (
                    <p className="muted">Selle sümboli kohta värskeid pealkirju ei leitud.</p>
                  )}
                  {(trendInsight?.news || []).map((n) => (
                    <a key={n.url} className="trend-news-item" href={n.url} target="_blank" rel="noreferrer">
                      <div className="trend-news-title">{n.title}</div>
                      {n.summary && <p className="trend-news-sum">{n.summary}</p>}
                      <div className="trend-news-meta muted">
                        {n.source}
                        {n.time ? ` · ${n.time}` : ''}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {topTab === 'ai' && userId && (
          <ClaudeChat
            key={`${userId}-${analystSeed || 'idle'}`}
            embedded
            seedPrompt={analystSeed}
            onBack={() => setTopTab('desk')}
            context={{
              headlines: (hotNews.length ? hotNews : symbolNews).slice(0, 6).map((n) => n.title),
              gainers: trends.filter((t) => t.kind === 'up').map((t) => ({ symbol: t.symbol, changePercent: 0 })),
              losers: trends.filter((t) => t.kind === 'down').map((t) => ({ symbol: t.symbol, changePercent: 0 })),
            }}
          />
        )}
      </div>
    </div>
    </AuthGate>
  );
}
