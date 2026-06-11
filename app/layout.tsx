import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';
import { AnonAuth } from '@/components/anon-auth';

export const metadata: Metadata = {
  title: 'World Cup Fever 2026',
  description:
    'Live scores, standings, bracket and tournament simulator for the FIFA World Cup 2026 — USA, Canada & Mexico.',
};

export const viewport: Viewport = {
  themeColor: '#0a0e1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AnonAuth />
        <Nav />
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-4 md:pb-10 md:pt-6">
          {children}
        </main>
      </body>
    </html>
  );
}
