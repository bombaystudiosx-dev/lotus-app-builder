'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, useTransition } from 'react'
import { Archive, Copy, FolderPlus, MoreHorizontal, RotateCcw, Settings, Trash2 } from 'lucide-react'
import type { Project, UserSettings } from '@/lib/db/schema'
import {
  archiveProjectAction,
  createBlankProjectAction,
  duplicateProjectAction,
  permanentlyDeleteProjectAction,
  renameProjectAction,
  restoreProjectAction,
  softDeleteProjectAction,
  updateSettingsAction,
} from '@/app/actions/projects'
import { useRouter } from 'next/navigation'
import { useResolvedTheme } from '@/components/lotus/use-resolved-theme'

type DashboardProject = Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>
type DashboardSettings = Pick<UserSettings, 'theme' | 'editorFontSize' | 'autosaveInterval' | 'defaultDevice'>

function dateLabel(value: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(status: DashboardProject['status']) {
  return status === 'trashed' ? 'In trash' : status.charAt(0).toUpperCase() + status.slice(1)
}

export function ProjectDashboard({ initialProjects, initialSettings, userName }: {
  initialProjects: DashboardProject[]
  initialSettings: DashboardSettings
  userName: string
}) {
  const router = useRouter()
  const [settings, setSettings] = useState(initialSettings)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const resolvedTheme = useResolvedTheme(settings.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark')
  }, [resolvedTheme])

  function run(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Something went wrong.')
      }
    })
  }

  function createProject() {
    run(async () => {
      const created = await createBlankProjectAction()
      router.push(`/projects/${created.id}`)
      router.refresh()
    })
  }

  function updatePreference<K extends keyof DashboardSettings>(key: K, value: DashboardSettings[K]) {
    run(async () => {
      const updated = await updateSettingsAction({ [key]: value })
      setSettings(updated)
    })
  }

  const active = initialProjects.filter((item) => item.status === 'active')
  const archived = initialProjects.filter((item) => item.status === 'archived')
  const trashed = initialProjects.filter((item) => item.status === 'trashed')
  const firstRun = initialProjects.length === 0

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/logo_lotus.png" alt="Lotus" width={42} height={42} />
            <span className="font-serif text-2xl font-medium">Lotus</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls="project-settings" className="rounded-lg p-2 hover:bg-muted focus-visible:outline-2" aria-label="Open settings">
              <Settings size={18} />
            </button>
            <div className="relative">
              <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-controls="account-menu" className="rounded-full bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2" aria-label={`Open workspace menu for ${userName}`}>
                {userName.trim().charAt(0).toUpperCase() || 'U'}
              </button>
              {accountOpen && <div id="account-menu" className="absolute right-0 z-10 mt-2 w-48 rounded-lg border border-border bg-popover p-2 shadow-lg">
                <p className="px-2 py-1 text-sm font-medium">{userName}</p>
                <p className="px-2 py-2 text-xs text-muted-foreground">Public workspace</p>
              </div>}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Your local workspace</p>
            <h1 className="mt-1 font-serif text-4xl font-medium tracking-tight">Projects</h1>
          </div>
          <button type="button" onClick={createProject} disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60">
            <FolderPlus size={18} /> Create blank project
          </button>
        </div>

        {error && <p role="alert" className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

        {firstRun ? <section className="mt-8 rounded-2xl border border-border bg-card p-8 text-center sm:p-12">
          <p className="text-sm font-medium text-accent">Welcome to Lotus</p>
          <h2 className="mt-2 font-serif text-3xl">Start with a blank project</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Create a project, then build and preview it in the shared public workspace.</p>
          <button type="button" onClick={createProject} disabled={pending} className="mt-6 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60">Create your first project</button>
        </section> : <>
          <ProjectSection title="Active projects" projects={active} empty="No active projects yet." pending={pending} onError={setError} onChanged={() => router.refresh()} />
          <ProjectSection title="Archived" projects={archived} empty="No archived projects." pending={pending} onError={setError} onChanged={() => router.refresh()} />
          <ProjectSection title="Trash" projects={trashed} empty="No projects in trash." pending={pending} onError={setError} onChanged={() => router.refresh()} />
        </>}

        {settingsOpen && <section id="project-settings" aria-label="Project settings" className="mt-8 max-w-xl rounded-xl border border-border bg-card p-5">
          <h2 className="font-serif text-2xl">Settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">These preferences are saved for the public workspace.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <SettingSelect label="Theme" value={settings.theme} disabled={pending} onChange={(value) => updatePreference('theme', value as DashboardSettings['theme'])} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} />
            <SettingSelect label="Editor font size" value={String(settings.editorFontSize)} disabled={pending} onChange={(value) => updatePreference('editorFontSize', Number(value))} options={[["12", "12 px"], ["14", "14 px"], ["16", "16 px"], ["18", "18 px"], ["20", "20 px"], ["24", "24 px"]]} />
            <SettingSelect label="Autosave interval" value={String(settings.autosaveInterval)} disabled={pending} onChange={(value) => updatePreference('autosaveInterval', Number(value))} options={[["5", "5 seconds"], ["15", "15 seconds"], ["30", "30 seconds"], ["60", "1 minute"], ["300", "5 minutes"]]} />
            <SettingSelect label="Default device" value={settings.defaultDevice} disabled={pending} onChange={(value) => updatePreference('defaultDevice', value as DashboardSettings['defaultDevice'])} options={[['phone', 'Phone'], ['tablet', 'Tablet'], ['desktop', 'Desktop']]} />
          </div>
        </section>}
      </div>
    </main>
  )
}

function SettingSelect({ label, value, options, disabled, onChange }: { label: string; value: string; options: [string, string][]; disabled: boolean; onChange: (value: string) => void }) {
  const id = `setting-${label.toLowerCase().replaceAll(' ', '-')}`
  return <label htmlFor={id} className="grid gap-1.5 text-sm font-medium">{label}
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 font-normal disabled:opacity-60">
      {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
  </label>
}

function ProjectSection({ title, projects, empty, pending, onError, onChanged }: {
  title: string
  projects: DashboardProject[]
  empty: string
  pending: boolean
  onError: (message: string | null) => void
  onChanged: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const disabled = pending || isPending
  function run(action: () => Promise<void>) {
    onError(null)
    startTransition(async () => {
      try {
        await action()
        onChanged()
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Something went wrong.')
      }
    })
  }
  return <section className="mt-9" aria-labelledby={`${title.toLowerCase().replaceAll(' ', '-')}-heading`}>
    <h2 id={`${title.toLowerCase().replaceAll(' ', '-')}-heading`} className="font-serif text-2xl">{title}</h2>
    {projects.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{empty}</p> : <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((item) => <li key={item.id} className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{item.status === 'trashed' ? <p className="truncate text-lg font-semibold">{item.name}</p> : <Link href={`/projects/${item.id}`} className="block truncate text-lg font-semibold hover:underline">{item.name}</Link>}<p className="mt-1 text-sm text-muted-foreground">{statusLabel(item.status)} · Updated {dateLabel(item.updatedAt)}</p></div>
          <MoreHorizontal aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {item.status !== 'trashed' && <Link href={`/projects/${item.id}`} className="rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted">Open</Link>}
          {item.status === 'active' && <>
            <button type="button" disabled={disabled} onClick={() => { const name = window.prompt('Project name', item.name); if (name !== null) run(async () => { await renameProjectAction(item.id, name) }) }} className="rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60">Rename</button>
            <button type="button" disabled={disabled} onClick={() => run(async () => { await duplicateProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60"><Copy size={14} />Duplicate</button>
            <button type="button" disabled={disabled} onClick={() => run(async () => { await archiveProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60"><Archive size={14} />Archive</button>
          </>}
          {item.status === 'archived' && <><button type="button" disabled={disabled} onClick={() => run(async () => { await restoreProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60"><RotateCcw size={14} />Restore</button><button type="button" disabled={disabled} onClick={() => run(async () => { await duplicateProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60"><Copy size={14} />Duplicate</button></>}
          {item.status === 'trashed' && <><button type="button" disabled={disabled} onClick={() => run(async () => { await restoreProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-60"><RotateCcw size={14} />Restore</button><button type="button" disabled={disabled} onClick={() => { if (window.confirm(`Permanently delete ${item.name}? This cannot be undone.`)) run(async () => { await permanentlyDeleteProjectAction(item.id) }) }} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"><Trash2 size={14} />Delete forever</button></>}
          {item.status !== 'trashed' && <button type="button" disabled={disabled} onClick={() => run(async () => { await softDeleteProjectAction(item.id) })} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2.5 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"><Trash2 size={14} />Move to trash</button>}
        </div>
      </li>)}
    </ul>}
  </section>
}
