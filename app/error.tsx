'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-20 text-center">
      <p aria-hidden className="text-6xl">🟨</p>
      <h1 className="mt-4 font-display text-2xl font-bold">VAR check — something went wrong</h1>
      <p className="mt-2 text-sm text-mist">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-gold px-4 py-2 font-bold text-night hover:bg-gold-bright"
      >
        Retry
      </button>
    </div>
  );
}
