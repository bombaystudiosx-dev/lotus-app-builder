'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

interface ApplicationErrorProps {
  message?: string
  reset?: () => void
}

export function ApplicationError({ message = 'Something went wrong. Please try again.', reset }: ApplicationErrorProps) {
  useEffect(() => {
    toast.error(message)
  }, [message])

  return (
    <main className="min-h-svh grid place-items-center bg-background px-6 text-center">
      <section className="max-w-md space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">We couldn&apos;t load Lotus</h1>
        <p className="text-sm leading-6 text-muted-foreground">{message}</p>
        {reset && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        )}
      </section>
    </main>
  )
}
