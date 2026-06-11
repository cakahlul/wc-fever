import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p aria-hidden className="text-6xl">🟥</p>
      <h1 className="mt-4 font-display text-2xl font-bold">Offside — page not found</h1>
      <p className="mt-2 text-mist">That page never made the squad.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-gold px-4 py-2 font-bold text-night hover:bg-gold-bright"
      >
        Back to kickoff
      </Link>
    </div>
  );
}
