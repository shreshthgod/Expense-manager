import Link from "next/link";

export const metadata = { title: "Offline" };

/** Served by the service worker when a page can't be reached. Shows no financial data. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">You're offline</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page needs a connection. Your data is safe on the server — nothing you haven't saved was lost, and nothing is changed while you're offline.
      </p>
      <Link href="/dashboard" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</Link>
    </main>
  );
}
