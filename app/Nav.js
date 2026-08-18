'use client';

export default function Nav({ active }) {
  return (
    <div className="nav">
      <a href="/" className="nav-brand">Desk</a>
      <a href="/" className={active === 'markets' || active === 'watchlist' ? 'active' : ''}>
        Raamat
      </a>
      <a href="/#trends" className={active === 'trends' ? 'active' : ''}>Turud</a>
      <a href="/" className={active === 'ai' ? 'active' : ''}>Analüütik</a>
    </div>
  );
}
