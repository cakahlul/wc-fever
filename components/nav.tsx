'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/live', label: 'Live', icon: '🔴' },
  { href: '/schedule', label: 'Schedule', icon: '🗓️' },
  { href: '/standings', label: 'Standings', icon: '📊' },
  { href: '/bracket', label: 'Bracket', icon: '🏆' },
  { href: '/simulator', label: 'Simulator', icon: '🎮' },
  { href: '/saved', label: 'Saved', icon: '💾' },
];

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Desktop top bar */}
      <header className="sticky top-0 z-40 hidden border-b border-night-50/60 bg-night-300/80 backdrop-blur md:block">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            <span className="text-gold-bright">WC</span> Fever{' '}
            <span className="text-mist">2026</span>
          </Link>
          <nav aria-label="Main navigation" className="flex gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  isActive(l.href)
                    ? 'bg-gold/15 text-gold-bright'
                    : 'text-mist hover:bg-night-50 hover:text-ice'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-night-50/60 bg-night-300/95 backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-7">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-label={l.label}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
                isActive(l.href) ? 'text-gold-bright' : 'text-mist'
              }`}
            >
              <span aria-hidden className="text-base leading-none">
                {l.icon}
              </span>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
