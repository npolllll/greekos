import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import './app.css';

const inter = Inter({ subsets: ['latin', 'cyrillic', 'greek'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: { default: 'GreekOS', template: '%s · GreekOS' },
  description: 'Новогреческий A1–B2: индивидуальный маршрут, практика, разговор и подготовка к экзаменам.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#faf8f5', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={inter.variable}>
      <body style={{ fontFamily: 'var(--font-inter), Inter, "Helvetica Neue", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif' }}>{children}</body>
    </html>
  );
}
