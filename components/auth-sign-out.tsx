'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { clearAiProviderAction } from '@/app/actions/projects'

export function AuthSignOut({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try { await clearAiProviderAction() } finally {
      await authClient.signOut()
      router.replace('/sign-in')
      router.refresh()
    }
  }

  return <button type="button" onClick={signOut} disabled={pending} aria-label="Sign out" className={compact ? 'rounded-lg p-2 text-[#806b60] hover:bg-[#fff3eb] disabled:opacity-50' : 'inline-flex items-center gap-2 rounded-xl border border-[#eadfd8] px-3 py-2 text-sm font-medium text-[#6d584d] hover:bg-[#fff3eb] disabled:opacity-50'}><LogOut size={16}/>{!compact && (pending ? 'Signing out…' : 'Sign out')}</button>
}
