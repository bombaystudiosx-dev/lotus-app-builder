import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-svh grid place-items-center bg-background px-6 text-center">
      <section className="space-y-4">
        <p className="text-sm font-medium text-accent">404</p>
        <h1 className="text-2xl font-semibold text-foreground">This page does not exist</h1>
        <Link className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="/">
          Return to Lotus
        </Link>
      </section>
    </main>
  )
}
