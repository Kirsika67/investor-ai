'use client';

import { useEffect, useState } from 'react';
import Nav from '../Nav';
import AuthGate from '../AuthGate';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthProvider';

export default function PortfolioPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [holdings, setHoldings] = useState([]);
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    loadHoldings();
  }, [userId]);

  async function loadHoldings() {
    setLoading(true);
    const { data, error: dbError } = await supabase
      .from('holdings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (dbError) {
      setError('Andmebaasi lugemine ebaõnnestus: ' + dbError.message);
      setLoading(false);
      return;
    }

    const withPrices = await Promise.all(
      (data || []).map(async (row) => {
        try {
          const res = await fetch(`/api/quote?symbol=${row.symbol}`);
          const quote = await res.json();
          return { ...row, currentPrice: quote.price, valid: quote.valid };
        } catch {
          return { ...row, valid: false };
        }
      })
    );

    setHoldings(withPrices);
    setLoading(false);
  }

  async function addHolding() {
    const sym = symbol.trim().toUpperCase();
    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(cost);
    setError('');

    if (!userId) {
      setError('Pead olema sisse logitud.');
      return;
    }

    if (!sym || isNaN(sharesNum) || isNaN(costNum) || sharesNum <= 0 || costNum <= 0) {
      setError('Täida sümbol, kogus ja ostuhind korrektselt.');
      return;
    }

    const { error: dbError } = await supabase
      .from('holdings')
      .insert({ symbol: sym, shares: sharesNum, cost_basis: costNum, user_id: userId });

    if (dbError) {
      setError('Lisamine ebaõnnestus: ' + dbError.message);
      return;
    }

    setSymbol(''); setShares(''); setCost('');
    loadHoldings();
  }

  async function removeHolding(id) {
    await supabase.from('holdings').delete().eq('id', id).eq('user_id', userId);
    loadHoldings();
  }

  const valid = holdings.filter((h) => h.valid !== false);
  const totalValue = valid.reduce((s, h) => s + h.currentPrice * h.shares, 0);
  const totalCost = valid.reduce((s, h) => s + h.cost_basis * h.shares, 0);
  const totalPl = totalValue - totalCost;
  const plPct = totalCost > 0 ? (totalPl / totalCost) * 100 : 0;
  const plUp = totalPl >= 0;

  return (
    <AuthGate>
    <div>
      <Nav active="portfolio" />
      <div className="page">
        {holdings.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '12px 16px', flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Portfelli väärtus</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 500 }}>${totalValue.toFixed(2)}</div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '12px 16px', flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Kasum/kahjum</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 500, color: plUp ? 'var(--gain)' : 'var(--loss)' }}>
                {plUp ? '+' : ''}${Math.abs(totalPl).toFixed(2)}
              </div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '12px 16px', flex: 1 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>Tootlus</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 500, color: plUp ? 'var(--gain)' : 'var(--loss)' }}>
                {plUp ? '+' : ''}{Math.abs(plPct).toFixed(2)}%
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr auto', gap: 8, marginBottom: 18 }}>
          <input placeholder="Sümbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <input placeholder="Kogus" type="number" value={shares} onChange={(e) => setShares(e.target.value)} />
          <input placeholder="Ostuhind ($)" type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          <button onClick={addHolding}>+ Lisa</button>
        </div>

        {error && <div style={{ color: 'var(--loss)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <table>
          <thead>
            <tr>
              <th>Sümbol</th>
              <th style={{ textAlign: 'right' }}>Kogus</th>
              <th style={{ textAlign: 'right' }}>Ostuhind</th>
              <th style={{ textAlign: 'right' }}>Hetkehind</th>
              <th style={{ textAlign: 'right' }}>Kasum/kahjum</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Laen...</td></tr>
            )}
            {!loading && holdings.length === 0 && (
              <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Lisa esimene osalus, et näha kasumit/kahjumit.</td></tr>
            )}
            {holdings.map((h) => {
              const pl = h.valid === false ? null : (h.currentPrice - h.cost_basis) * h.shares;
              const up = pl >= 0;
              return (
                <tr key={h.id}>
                  <td className="mono" style={{ color: 'var(--gold)', fontWeight: 600 }}>{h.symbol}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{h.shares}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>${h.cost_basis.toFixed(2)}</td>
                  {h.valid === false ? (
                    <td colSpan={2} style={{ color: 'var(--loss)' }}>Hinda ei leitud</td>
                  ) : (
                    <>
                      <td className="mono" style={{ textAlign: 'right' }}>${h.currentPrice?.toFixed(2)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: up ? 'var(--gain)' : 'var(--loss)' }}>
                        {up ? '+' : ''}${Math.abs(pl).toFixed(2)}
                      </td>
                    </>
                  )}
                  <td>
                    <button onClick={() => removeHolding(h.id)} style={{ border: 'none', color: 'var(--muted)' }}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
    </AuthGate>
  );
}
