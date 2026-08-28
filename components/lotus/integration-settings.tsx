'use client'

import { useEffect, useState, useTransition } from 'react'
import { Check, ExternalLink, GitBranch, Plug, ShieldCheck, Unplug } from 'lucide-react'
import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  getIntegrationStatusesAction,
} from '@/app/actions/projects'
import type { IntegrationConnectionStatus, IntegrationProvider } from '@/lib/integration-connections'

const PROVIDERS: Array<{
  id: IntegrationProvider
  name: string
  description: string
  credentialLabel: string
  placeholder: string
  docs: string
  multiline?: boolean
}> = [
  { id: 'github', name: 'GitHub', description: 'Access repositories and prepare source deployments.', credentialLabel: 'Personal access token', placeholder: 'github_pat_…', docs: 'https://github.com/settings/personal-access-tokens/new' },
  { id: 'vercel', name: 'Vercel', description: 'Access projects, deployments, and domains.', credentialLabel: 'Access token', placeholder: 'Paste a Vercel access token', docs: 'https://vercel.com/account/settings/tokens' },
  { id: 'supabase', name: 'Supabase', description: 'Connect projects, databases, and backend services.', credentialLabel: 'Personal access token', placeholder: 'sbp_…', docs: 'https://supabase.com/dashboard/account/tokens' },
  { id: 'firebase', name: 'Firebase', description: 'Verify a Firebase project through a Google service account.', credentialLabel: 'Service-account JSON', placeholder: '{\n  "type": "service_account",\n  "project_id": "…"\n}', docs: 'https://console.firebase.google.com/', multiline: true },
  { id: 'appstore', name: 'Apple App Store Connect', description: 'Connect Apple apps, TestFlight, and App Store releases.', credentialLabel: 'App Store Connect credential JSON', placeholder: '{\n  "issuerId": "…",\n  "keyId": "…",\n  "privateKey": "-----BEGIN PRIVATE KEY-----\\n…"\n}', docs: 'https://appstoreconnect.apple.com/access/integrations/api', multiline: true },
  { id: 'googleplay', name: 'Google Play Console', description: 'Connect Android publishing and Play release tracks.', credentialLabel: 'Google Play service-account JSON', placeholder: '{\n  "type": "service_account",\n  "project_id": "…"\n}', docs: 'https://play.google.com/console/developers/api-access', multiline: true },
]

function emptyStatuses(): IntegrationConnectionStatus[] {
  return PROVIDERS.map(({ id }) => ({ provider: id, connected: false, accountLabel: '', status: 'disconnected', lastVerifiedAt: null }))
}

export function IntegrationSettings({ providerIds = ['github', 'vercel', 'supabase', 'firebase'] }: { providerIds?: IntegrationProvider[] }) {
  const providers = PROVIDERS.filter(provider => providerIds.includes(provider.id))
  const [statuses, setStatuses] = useState(emptyStatuses)
  const [editing, setEditing] = useState<IntegrationProvider | null>(null)
  const [credential, setCredential] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    getIntegrationStatusesAction()
      .then(result => { if (active && result.length) setStatuses(result) })
      .catch(() => { if (active) setMessage('Connections could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  function updateStatus(status: IntegrationConnectionStatus) {
    setStatuses(current => current.map(item => item.provider === status.provider ? status : item))
  }

  function submit(provider: IntegrationProvider) {
    setMessage(null)
    startTransition(async () => {
      const result = await connectIntegrationAction({ provider, credential })
      if (!result.ok) { setMessage(result.error); return }
      updateStatus(result.status)
      setCredential('')
      setEditing(null)
      setMessage(`${PROVIDERS.find(item => item.id === provider)?.name} connected and verified.`)
    })
  }

  function disconnect(provider: IntegrationProvider) {
    if (!window.confirm(`Disconnect ${PROVIDERS.find(item => item.id === provider)?.name}? The stored credential will be deleted.`)) return
    setMessage(null)
    startTransition(async () => {
      try {
        updateStatus(await disconnectIntegrationAction(provider))
        setEditing(null)
        setCredential('')
      } catch { setMessage('The connection could not be disconnected. Please try again.') }
    })
  }

  return <div>
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-[#fff7f1] p-3 text-sm dark:bg-white/5">
      <ShieldCheck className="mt-0.5 shrink-0 text-[#b87850]" size={18}/>
      <p className="leading-5 text-[#6d584d] dark:text-[#c8b8ae]">Lotus verifies each credential with its provider, encrypts it before database storage, and never sends the saved value back to the browser.</p>
    </div>
    {message && <div role="status" className={`mb-4 rounded-xl border px-3 py-2 text-sm ${/connected and verified/i.test(message) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{message}</div>}
    <div className="grid gap-3">
      {providers.map(provider => {
        const status = statuses.find(item => item.provider === provider.id)!
        const open = editing === provider.id
        return <section key={provider.id} className="rounded-xl border border-[#eadfd8] p-4 dark:border-white/10">
          <div className="flex flex-wrap items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#fff0e5] text-[#b87850] dark:bg-white/10">{provider.id === 'github' ? <GitBranch size={18}/> : <Plug size={18}/>}</div>
            <div className="min-w-[180px] flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{provider.name}</p>{status.connected && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><Check size={11}/>Connected</span>}</div><p className="mt-1 text-xs leading-5 text-[#806b60] dark:text-[#bba99f]">{status.connected ? `Verified account: ${status.accountLabel}` : provider.description}</p></div>
            <div className="flex items-center gap-2">
              <a href={provider.docs} target="_blank" rel="noreferrer" className="rounded-lg border border-[#eadfd8] p-2 text-[#806b60] dark:border-white/10" aria-label={`Open ${provider.name} credential settings`}><ExternalLink size={15}/></a>
              {status.connected && <button type="button" disabled={pending} onClick={() => disconnect(provider.id)} className="inline-flex items-center gap-1 rounded-lg border border-[#eadfd8] px-3 py-2 text-xs font-medium dark:border-white/10"><Unplug size={14}/>Disconnect</button>}
              <button type="button" disabled={pending || loading} onClick={() => { setEditing(open ? null : provider.id); setCredential(''); setMessage(null) }} className="rounded-lg bg-[#e98b66] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{status.connected ? 'Update' : 'Connect'}</button>
            </div>
          </div>
          {open && <form className="mt-4 border-t border-[#f0e5de] pt-4 dark:border-white/10" onSubmit={event => { event.preventDefault(); submit(provider.id) }}>
            <label className="grid gap-1.5 text-sm font-medium">{provider.credentialLabel}{provider.multiline
              ? <textarea value={credential} onChange={event => setCredential(event.target.value)} required autoComplete="off" spellCheck={false} rows={7} placeholder={provider.placeholder} className="input resize-y py-3 font-mono text-xs"/>
              : <input type="password" value={credential} onChange={event => setCredential(event.target.value)} required autoComplete="off" spellCheck={false} placeholder={provider.placeholder} className="input"/>}</label>
            <div className="mt-3 flex items-center justify-end gap-2"><button type="button" onClick={() => { setEditing(null); setCredential('') }} className="rounded-lg border border-[#eadfd8] px-3 py-2 text-xs dark:border-white/10">Cancel</button><button type="submit" disabled={pending || credential.trim().length < 8} className="rounded-lg bg-[#e98b66] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{pending ? 'Verifying…' : 'Verify and save'}</button></div>
          </form>}
        </section>
      })}
    </div>
  </div>
}
