import './globals.css';
import { AuthProvider } from '../lib/AuthProvider';

export const metadata = {
  title: 'Investor AI Desk',
  description: 'Research desk: arvuta, kas aktsia on mõistlik — P/E, PEG, Graham, Lynch, Buffett.',
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
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
