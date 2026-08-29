'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GitBranch, GitFork, LockKeyhole, Search, X } from 'lucide-react'
import { importGitHubRepositoryAction, listGitHubBranchesAction, listGitHubRepositoriesAction } from '@/app/actions/projects'
import type { GitHubBranch, GitHubRepository } from '@/lib/github-import'

export function GitHubImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [repositories, setRepositories] = useState<GitHubRepository[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadingRepositories, setLoadingRepositories] = useState(true)
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let active = true
    listGitHubRepositoriesAction()
      .then(result => {
        if (!active) return
        if (!result.ok) { setError(result.error); return }
        const items = result.repositories
        setRepositories(items)
        if (items[0]) selectRepository(items[0], false)
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : 'GitHub repositories could not be loaded.'))
      .finally(() => active && setLoadingRepositories(false))
    return () => { active = false }
  }, [])

  const visible = useMemo(() => repositories.filter(item => `${item.fullName} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [query, repositories])

  function selectRepository(item: GitHubRepository, clearError = true) {
    setRepository(item.fullName)
    setBranch(item.defaultBranch)
    setBranches([])
    if (clearError) setError(null)
    setLoadingBranches(true)
    listGitHubBranchesAction(item.fullName)
      .then(result => {
        if (!result.ok) { setError(result.error); return }
        setBranches(result.branches)
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Branches could not be loaded.'))
      .finally(() => setLoadingBranches(false))
  }

  function importRepository() {
    if (!repository || !branch) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await importGitHubRepositoryAction({ repository, branch })
        if (!result.ok) { setError(result.error); return }
        router.push(`/projects/${result.project.id}`)
        router.refresh()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'The repository could not be imported.')
      }
    })
  }

  return <div role="presentation" className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !pending) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="github-import-title" className="flex max-h-[90svh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#eadfd8] bg-[#fffdfb] shadow-2xl dark:border-white/10 dark:bg-[#211b18]">
      <div className="flex items-start justify-between gap-4 border-b border-[#eadfd8] p-5 dark:border-white/10 sm:p-6">
        <div className="flex gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#241b16] text-white"><GitFork size={21}/></span><div><h2 id="github-import-title" className="text-xl font-bold">Import from GitHub</h2><p className="mt-1 text-sm text-[#806b60] dark:text-[#bba99f]">Bring a repository and its branch into your private Lotus workspace.</p></div></div>
        <button type="button" onClick={onClose} disabled={pending} aria-label="Close GitHub import" className="rounded-lg p-2 hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"><X size={18}/></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}{error.includes('Connect GitHub') && <button type="button" onClick={() => { onClose(); router.push('/?section=settings') }} className="ml-2 font-semibold underline">Open Settings</button>}</div>}
        {loadingRepositories ? <div className="grid min-h-52 place-items-center text-sm text-[#806b60]">Loading your GitHub repositories…</div> : repositories.length === 0 && !error ? <div className="grid min-h-52 place-items-center text-center"><div><GitFork className="mx-auto text-[#b87850]"/><p className="mt-3 font-semibold">No repositories available</p><p className="mt-1 text-sm text-[#806b60]">The connected GitHub account did not return any repositories.</p></div></div> : repositories.length > 0 && <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_250px]">
          <div className="min-w-0">
            <label className="flex items-center gap-2 rounded-xl border border-[#eadfd8] bg-white px-3 dark:border-white/10 dark:bg-white/5"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search repositories" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">{visible.map(item => <button key={item.fullName} type="button" onClick={() => selectRepository(item)} aria-pressed={repository === item.fullName} className="w-full rounded-xl border border-[#eadfd8] p-3 text-left transition hover:border-[#d9b8a6] aria-pressed:border-[#e98b66] aria-pressed:bg-[#fff3eb] dark:border-white/10 dark:aria-pressed:bg-white/10"><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.fullName}</span>{item.private && <LockKeyhole aria-label="Private repository" size={14} className="text-[#806b60]"/>}</span><span className="mt-1 block truncate text-xs text-[#806b60] dark:text-[#bba99f]">{item.description || 'No description'}</span></button>)}</div>
          </div>
          <aside className="rounded-xl border border-[#eadfd8] bg-white p-4 dark:border-white/10 dark:bg-white/5"><p className="text-sm font-semibold">Import settings</p><label className="mt-4 grid gap-1.5 text-xs font-semibold">Branch<select value={branch} disabled={!repository || loadingBranches} onChange={event => setBranch(event.target.value)} className="input text-sm font-normal"><option value="">{loadingBranches ? 'Loading branches…' : 'Select branch'}</option>{branches.map(item => <option key={item.name} value={item.name}>{item.name}{item.protected ? ' · protected' : ''}</option>)}</select></label><div className="mt-4 rounded-lg bg-[#fff6f0] p-3 text-xs leading-5 text-[#6d584d] dark:bg-white/5 dark:text-[#c8b8ae]"><GitBranch size={15} className="mb-2"/>Lotus imports supported text source files. Secrets, private keys, binaries, and oversized files are skipped.</div></aside>
        </div>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-[#eadfd8] p-4 dark:border-white/10 sm:px-6"><button type="button" onClick={onClose} disabled={pending} className="rounded-xl border border-[#eadfd8] px-4 py-2 text-sm disabled:opacity-50 dark:border-white/10">Cancel</button><button type="button" onClick={importRepository} disabled={pending || !repository || !branch || loadingBranches} className="rounded-xl bg-[#e98b66] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Importing repository…' : 'Import project'}</button></div>
    </section>
  </div>
}
