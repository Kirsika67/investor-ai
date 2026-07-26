'use client';

export default function Nav({ active }) {
  return (
    <div className="nav">
      <a href="/" className="nav-brand">Investor AI</a>
      <a href="/" className={active === 'markets' || active === 'watchlist' ? 'active' : ''}>
        My Watchlist
      </a>
      <a href="/#trends" className={active === 'trends' ? 'active' : ''}>Trendid</a>
      <a href="/ai" className={active === 'ai' ? 'active' : ''}>AI vestlus</a>
    </div>
  );
}
