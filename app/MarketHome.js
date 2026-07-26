'use client';

import { useEffect, useState } from 'react';
import Nav from './Nav';

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(2)}%`;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}`;
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
  if (mins < 60) return `${mins} min tagasi`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h tagasi`;
  return `${Math.round(hrs / 24)} p tagasi`;
}

function MoverRow({ row }) {
  const up = row.changePercent >= 0;
  return (
    <div className="mover-row">
      <div>
        <div className="mover-sym mono">{row.symbol}</div>
        <div className="mover-price mono">{fmtPrice(row.price)}</div>
      </div>
      <div className={`mover-pct mono ${up ? 'up' : 'down'}`}>{fmtPct(row.changePercent)}</div>
    </div>
  );
}

export default function MarketHome() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/market');
      const json = await res.json();
      if (json.error && !json.news?.items?.length && !json.movers?.gainers?.length) {
        setError(json.error);
      }
      setData(json);
    } catch (e) {
      setError(e.message || 'Laadimine ebaõnnestus');
    }
    setLoading(false);
  }

  const tape = data?.tape || [];
  const news = data?.news?.items || [];
  const trendNews = data?.trendNews?.items || [];
  const brief = data?.brief;
  const gainers = data?.movers?.gainers || [];
  const losers = data?.movers?.losers || [];
  const active = data?.movers?.mostActive || [];
  const alerts = [
    ...(gainers.slice(0, 2).map((g) => `↑ ${g.symbol} ${fmtPct(g.changePercent)}`)),
    ...(losers.slice(0, 2).map((l) => `↓ ${l.symbol} ${fmtPct(l.changePercent)}`)),
    ...trendNews.slice(0, 3).map((n) => n.title),
    ...news.slice(0, 3).map((n) => n.title),
  ];

  return (
    <div className="market-shell">
      <Nav active="markets" />

      <div className="tape" aria-hidden="true">
        <div className="tape-track">
          {[...tape, ...tape].map((t, i) => {
            if (t.title) {
              return (
                <span key={`${t.symbol}-${i}`} className="tape-item">
                  <b>{t.symbol}</b> {t.title}
                </span>
              );
            }
            const up = t.changePercent >= 0;
            return (
              <span key={`${t.symbol}-${i}`} className="tape-item mono">
                <b>{t.symbol}</b> {fmtPrice(t.price)}{' '}
                <span className={up ? 'up' : 'down'}>{fmtPct(t.changePercent)}</span>
              </span>
            );
          })}
          {tape.length === 0 && !loading && (
            <span className="tape-item">Turu ticker ootab andmeid…</span>
          )}
        </div>
      </div>

      <div className="market-page">
        <section className="today">
          <div className="today-label">Täna turul</div>
          {loading ? (
            <h1 className="today-headline">Laen turu ülevaadet…</h1>
          ) : (
            <h1 className="today-headline">{brief?.headline || 'Turu ülevaade'}</h1>
          )}
          <ul className="today-bullets">
            {(brief?.bullets || []).map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <button type="button" onClick={load} className="refresh-btn">
            Värskenda
          </button>
          {error && <p className="error-line">{error}</p>}
        </section>

        <div className="market-grid">
          <section id="uudised" className="news-col">
            <h2 className="section-title">Uudised ja teated</h2>
            {loading && <p className="muted">Laen uudiseid…</p>}
            {!loading && news.length === 0 && (
              <p className="muted">Uudiseid pole hetkel saadaval (API limiit või viga).</p>
            )}
            <div className="news-list">
              {news.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="news-item">
                  {item.image ? (
                    <img src={item.image} alt="" className="news-thumb" />
                  ) : (
                    <div className="news-thumb placeholder" />
                  )}
                  <div className="news-body">
                    <div className="news-title">{item.title}</div>
                    <div className="news-meta">
                      <span>{item.source}</span>
                      <span>{timeAgo(item.time)}</span>
                      {item.sentiment && <span className="news-sent">{item.sentiment}</span>}
                    </div>
                    {item.tickers?.length > 0 && (
                      <div className="news-tickers">
                        {item.tickers.map((t) => (
                          <span key={t.symbol} className="pill mono">
                            {t.symbol}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </section>

          <aside id="trendid" className="side-col">
            <h2 className="section-title">Uued trendid</h2>
            <div className="trend-block">
              <h3 className="trend-label">Kõige aktiivsemad</h3>
              {active.slice(0, 5).map((row) => (
                <MoverRow key={`a-${row.symbol}`} row={row} />
              ))}
            </div>
            <div className="trend-block">
              <h3 className="trend-label up">Tõusjad</h3>
              {gainers.slice(0, 5).map((row) => (
                <MoverRow key={`g-${row.symbol}`} row={row} />
              ))}
            </div>
            <div className="trend-block">
              <h3 className="trend-label down">Langejad</h3>
              {losers.slice(0, 5).map((row) => (
                <MoverRow key={`l-${row.symbol}`} row={row} />
              ))}
            </div>

            <div className="trend-news">
              <h3 className="trend-label">Trendi uudised</h3>
              {trendNews.length === 0 && !loading && (
                <p className="muted">Trendi-uudised ilmuvad siia, kui liikumised on teada.</p>
              )}
              {trendNews.slice(0, 10).map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="trend-news-item">
                  <div className="trend-news-title">{item.title}</div>
                  <div className="news-meta">
                    {item.relatedSymbol && <span className="pill mono">{item.relatedSymbol}</span>}
                    <span>{item.source}</span>
                    <span>{timeAgo(item.time)}</span>
                  </div>
                </a>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <div className="alert-tape" aria-live="polite">
        <div className="alert-track">
          {[...alerts, ...alerts].map((msg, i) => (
            <span key={`${i}-${msg.slice(0, 24)}`} className="alert-item">
              {msg}
            </span>
          ))}
          {alerts.length === 0 && (
            <span className="alert-item">Teated ilmuvad siia, kui turuandmed on laetud</span>
          )}
        </div>
      </div>
    </div>
  );
}
