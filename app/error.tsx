'use client'

import { ApplicationError } from '@/components/application-error'

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ApplicationError reset={reset} />
}
