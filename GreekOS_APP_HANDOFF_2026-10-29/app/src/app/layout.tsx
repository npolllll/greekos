import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Serif_Display } from 'next/font/google';
import { Scene } from '@/components/Scene';
import './globals.css';
import './app.css';

const inter = Inter({ subsets: ['latin', 'cyrillic', 'greek'], display: 'swap', variable: '--font-inter' });
// Display serif with full Greek + Cyrillic coverage (brand, Greek phrases, quiet emphasis).
const serif = Noto_Serif_Display({ subsets: ['latin', 'cyrillic', 'greek'], display: 'swap', variable: '--font-display-serif', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: { default: 'GreekOS', template: '%s · GreekOS' },
  description: 'Новогреческий A0–B2: индивидуальный маршрут, практика, живой разговор и подготовка к экзаменам.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#efe5d8', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} ${serif.variable}`}>
      <body>
        <Scene />
        {children}
      </body>
    </html>
  );
}
