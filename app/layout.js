import './globals.css';

export const metadata = {
  title: 'Investor AI — Stocks',
  description: 'Yahoo Finance stiilis aktsiate jälgija + trendid + AI',
};

export default function RootLayout({ children }) {
  return (
    <html lang="et">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
