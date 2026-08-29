'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight, ChevronRight, CircleDot, Eye, Folder,
  Grid2X2, KeyRound, LayoutGrid, List, Menu, Monitor, Moon, MoreHorizontal, Plus,
  Rocket, Search, Settings, Smartphone, Sun, X,
} from 'lucide-react'
import type { Project, UserSettings } from '@/lib/db/schema'
import type { AiProviderStatus } from '@/lib/ai-provider'
import {
  archiveProjectAction, buildProjectPreviewAction, clearAiProviderAction, createBlankProjectAction, createTemplateProjectAction,
  duplicateProjectAction, getAiProviderStatusAction, permanentlyDeleteProjectAction,
  renameProjectAction, restoreProjectAction, saveAiProviderAction, softDeleteProjectAction, updateSettingsAction,
} from '@/app/actions/projects'
import { PreviewWorkbench } from '@/components/lotus/preview-workbench'
import { useResolvedTheme } from '@/components/lotus/use-resolved-theme'
import { IntegrationSettings } from '@/components/lotus/integration-settings'
import { MobileDeploymentSettings } from '@/components/lotus/mobile-deployment-settings'
import { PROJECT_FRAMEWORKS, type ProjectFramework } from '@/lib/project-framework'
import { TEMPLATE_CATALOG } from '@/lib/template-catalog'

type DashboardProject = Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'> & { framework: string }
type DashboardSettings = Pick<UserSettings, 'theme' | 'editorFontSize' | 'autosaveInterval' | 'defaultDevice'>
type ProductSection = 'projects' | 'templates' | 'preview' | 'deploy' | 'settings'

const SECTIONS: Array<{ id: ProductSection; label: string; icon: typeof Folder }> = [
  { id: 'projects', label: 'Projects', icon: Folder },
  { id: 'templates', label: 'Templates', icon: Grid2X2 },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))
}

function frameworkLabel(value: string) {
  if (value === 'static') return 'Static HTML'
  if (value === 'nextjs') return 'Next.js'
  if (value === 'expo') return 'Expo'
  return 'React'
}

function sectionHref(section: ProductSection) { return section === 'projects' ? '/' : `/?section=${section}` }

export function ProductShell({ initialProjects, initialSettings, userName, initialSection = 'projects' }: {
  initialProjects: DashboardProject[]
  initialSettings: DashboardSettings
  userName: string
  initialSection?: ProductSection
}) {
  const router = useRouter()
  const [section, setSection] = useState<ProductSection>(initialSection)
  const projects = initialProjects
  const [settings, setSettings] = useState(initialSettings)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const resolvedTheme = useResolvedTheme(settings.theme)

  useEffect(() => { document.documentElement.classList.toggle('dark', resolvedTheme === 'dark') }, [resolvedTheme])

  function navigate(next: ProductSection) {
    setSection(next)
    setDrawerOpen(false)
    router.push(sectionHref(next), { scroll: false })
  }

  function run(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Something went wrong.') }
    })
  }

  function createProject(input: { name: string; framework: ProjectFramework }) {
    run(async () => {
      const created = await createBlankProjectAction(input)
      setNewProjectOpen(false)
      router.push(`/projects/${created.id}`)
      router.refresh()
    })
  }

  return <div className="min-h-svh bg-[#fffdfb] text-[#281f1a] dark:bg-[#171310] dark:text-[#f8eee8]">
    <ProductSidebar section={section} userName={userName} drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={navigate}/>
    <div className="min-h-svh lg:pl-[248px]">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#eadfd8] bg-[#fffdfb]/95 px-4 backdrop-blur sm:px-7 lg:px-10 dark:border-white/10 dark:bg-[#171310]/95">
        <button type="button" onClick={() => setDrawerOpen(true)} className="rounded-lg p-2 lg:hidden" aria-label="Open navigation"><Menu size={20}/></button>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Lotus App Builder</p><p className="truncate text-xs text-[#806b60] dark:text-[#bba99f]">Local product workspace</p></div>
        <button type="button" onClick={() => run(async () => { setSettings(await updateSettingsAction({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })) })} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#eadfd8] bg-white dark:border-white/10 dark:bg-white/5" aria-label="Toggle theme">{resolvedTheme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
        <Link href="/docs" className="hidden rounded-lg border border-[#eadfd8] bg-white px-3 py-2 text-sm font-medium sm:block dark:border-white/10 dark:bg-white/5">Docs</Link>
      </header>
      <main className="px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {section === 'projects' && <ProjectsWorkspace projects={projects} pending={pending} onCreate={() => setNewProjectOpen(true)} onError={setError} onRefresh={() => router.refresh()} run={run}/>}
        {section === 'templates' && <TemplatesWorkspace pending={pending} run={run} router={router}/>}
        {section === 'preview' && <DedicatedPreview projects={projects.filter(project => project.status === 'active')}/>}
        {section === 'deploy' && <DeployWorkspace projects={projects.filter(project => project.status === 'active')}/>}
        {section === 'settings' && <SettingsWorkspace projects={projects.filter(project => project.status === 'active')} settings={settings} setSettings={setSettings} pending={pending} run={run}/>}
      </main>
    </div>
    {newProjectOpen && <NewProjectDialog pending={pending} onClose={() => setNewProjectOpen(false)} onCreate={createProject}/>}
  </div>
}

function NewProjectDialog({ pending, onClose, onCreate }: { pending: boolean; onClose: () => void; onCreate: (input: { name: string; framework: ProjectFramework }) => void }) {
  const [name, setName] = useState('Untitled project')
  const [framework, setFramework] = useState<ProjectFramework>('static')
  return <div role="presentation" className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="new-project-title" className="max-h-[90svh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#eadfd8] bg-[#fffdfb] p-5 shadow-2xl dark:border-white/10 dark:bg-[#211b18] sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><h2 id="new-project-title" className="text-xl font-bold">Create a new project</h2><p className="mt-1 text-sm text-[#806b60] dark:text-[#bba99f]">Choose the framework Lotus should persist, preview, and generate for.</p></div><button type="button" onClick={onClose} aria-label="Close new project dialog" className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"><X size={18}/></button></div>
      <label className="mt-5 grid gap-1.5 text-sm font-medium">Project name<input autoFocus className="input" value={name} maxLength={100} onChange={event => setName(event.target.value)}/></label>
      <fieldset className="mt-5"><legend className="text-sm font-semibold">Framework</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{PROJECT_FRAMEWORKS.map(item => <label key={item.id} className={`cursor-pointer rounded-xl border p-4 transition ${framework === item.id ? 'border-[#e98b66] bg-[#fff3eb] dark:bg-white/10' : 'border-[#eadfd8] hover:border-[#d9b8a6] dark:border-white/10'}`}><input type="radio" name="framework" value={item.id} checked={framework === item.id} onChange={() => setFramework(item.id)} className="sr-only"/><span className="flex items-center justify-between gap-2"><span className="font-semibold">{item.label}</span><span className="text-[10px] font-semibold uppercase tracking-wide text-[#b46743]">{item.platforms}</span></span><span className="mt-1 block text-xs leading-5 text-[#806b60] dark:text-[#bba99f]">{item.description}</span></label>)}</div></fieldset>
      <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-[#eadfd8] px-4 py-2 text-sm dark:border-white/10">Cancel</button><button type="button" disabled={pending || !name.trim()} onClick={() => onCreate({ name, framework })} className="rounded-xl bg-[#e98b66] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? 'Creating…' : `Create ${PROJECT_FRAMEWORKS.find(item => item.id === framework)?.label} project`}</button></div>
    </section>
  </div>
}

function ProductSidebar({ section, userName, drawerOpen, onClose, onNavigate }: { section: ProductSection; userName: string; drawerOpen: boolean; onClose: () => void; onNavigate: (section: ProductSection) => void }) {
  return <>
    {drawerOpen && <button type="button" className="fixed inset-0 z-40 bg-black/25 lg:hidden" onClick={onClose} aria-label="Close navigation overlay"/>}
    <aside aria-label="Lotus navigation" className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[#eadfd8] bg-[#fffcfa] px-5 pb-5 pt-7 transition-transform lg:translate-x-0 dark:border-white/10 dark:bg-[#1c1714] ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-lg p-2 lg:hidden" aria-label="Close navigation"><X size={18}/></button>
      <Link href="/" onClick={onClose} className="flex flex-col items-center pt-2">
        <Image src="/logo_lotus.png" alt="Lotus" width={124} height={124} className="h-[124px] w-[124px] object-contain" priority/>
        <span className="-mt-1 text-[10px] font-semibold tracking-[0.32em] text-[#6b5143] dark:text-[#ccb9ae]">APP BUILDER</span>
      </Link>
      <nav className="mt-8 grid gap-1.5">
        {SECTIONS.slice(0, 4).map(item => <SidebarButton key={item.id} item={item} active={section === item.id} onNavigate={onNavigate}/>)}
      </nav>
      <nav className="mt-auto border-t border-[#eadfd8] pt-4 dark:border-white/10"><SidebarButton item={SECTIONS[4]} active={section === 'settings'} onNavigate={onNavigate}/></nav>
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#eadfd8] bg-white p-3 dark:border-white/10 dark:bg-white/5"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ffc399] text-xs font-bold text-[#4d3426]">{userName.slice(0,2).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{userName}</p><p className="text-xs text-[#806b60] dark:text-[#bba99f]">Founder</p></div></div>
    </aside>
  </>
}

function SidebarButton({ item, active, onNavigate }: { item: typeof SECTIONS[number]; active: boolean; onNavigate: (section: ProductSection) => void }) {
  const Icon = item.icon
  return <button type="button" onClick={() => onNavigate(item.id)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition ${active ? 'bg-[#fff0e5] font-semibold text-[#3c2a20] dark:bg-white/10 dark:text-white' : 'text-[#5f4a3f] hover:bg-[#fff6f0] dark:text-[#cbbab0] dark:hover:bg-white/5'}`}><Icon size={19}/>{item.label}</button>
}

function WorkspaceHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1><p className="mt-2 text-sm text-[#806b60] sm:text-base dark:text-[#bba99f]">{subtitle}</p></div>{actions}</div>
}

function ProjectsWorkspace({ projects, pending, onCreate, onError, onRefresh, run }: { projects: DashboardProject[]; pending: boolean; onCreate: () => void; onError: (error: string | null) => void; onRefresh: () => void; run: (action: () => Promise<void>) => void }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('active')
  const [sort, setSort] = useState('updated')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const visible = useMemo(() => projects.filter(item => (status === 'all' || item.status === status) && item.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : +new Date(b.updatedAt) - +new Date(a.updatedAt)), [projects, query, sort, status])
  return <>
    <WorkspaceHeader title="Projects" subtitle="Build, manage, and continue working on your apps." actions={<button type="button" onClick={onCreate} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#e98b66] px-4 text-sm font-semibold text-white disabled:opacity-60"><Plus size={17}/>{pending ? 'Creating…' : 'New Project'}</button>}/>
    <div className="mt-7 flex flex-wrap gap-2"><label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-[#eadfd8] bg-white px-3 dark:border-white/10 dark:bg-white/5"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search projects" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"/></label><select aria-label="Filter projects" value={status} onChange={event => setStatus(event.target.value)} className="rounded-xl border border-[#eadfd8] bg-white px-3 text-sm dark:border-white/10 dark:bg-[#211b18]"><option value="active">Active</option><option value="archived">Archived</option><option value="trashed">Trash</option><option value="all">All statuses</option></select><select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)} className="rounded-xl border border-[#eadfd8] bg-white px-3 text-sm dark:border-white/10 dark:bg-[#211b18]"><option value="updated">Recently updated</option><option value="name">Name</option></select><div className="flex rounded-xl border border-[#eadfd8] bg-white p-1 dark:border-white/10 dark:bg-white/5"><button type="button" onClick={() => setLayout('grid')} aria-label="Grid view" aria-pressed={layout === 'grid'} className="rounded-lg p-2 aria-pressed:bg-[#fff0e5] dark:aria-pressed:bg-white/10"><LayoutGrid size={16}/></button><button type="button" onClick={() => setLayout('list')} aria-label="List view" aria-pressed={layout === 'list'} className="rounded-lg p-2 aria-pressed:bg-[#fff0e5] dark:aria-pressed:bg-white/10"><List size={16}/></button></div></div>
    {visible.length === 0 ? <EmptyState title="No matching projects" body="Create a new project or change the current search and filters." action="New Project" onAction={onCreate}/> : <div className={`mt-6 ${layout === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'grid gap-2'}`}>{visible.map(item => <ProjectCard key={item.id} item={item} compact={layout === 'list'} pending={pending} onError={onError} onRefresh={onRefresh} run={run}/>)}</div>}
  </>
}

function ProjectCard({ item, compact, pending, onRefresh, run }: { item: DashboardProject; compact: boolean; pending: boolean; onError: (error: string | null) => void; onRefresh: () => void; run: (action: () => Promise<void>) => void }) {
  const [menu, setMenu] = useState(false)
  const status = item.status === 'active' ? 'Draft' : item.status === 'archived' ? 'Archived' : 'In trash'
  const mutate = (action: () => Promise<unknown>) => run(async () => { await action(); setMenu(false); onRefresh() })
  return <article className={`relative border border-[#eadfd8] bg-white dark:border-white/10 dark:bg-white/5 ${compact ? 'flex items-center gap-4 rounded-xl p-3' : 'rounded-2xl p-4'}`}>
    <div className={`${compact ? 'h-14 w-20' : 'h-36 w-full'} flex shrink-0 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_60%_20%,#fff,transparent_32%),linear-gradient(135deg,#f8e4d7,#fff8f2)] text-[#b87850]`}><Monitor size={compact ? 22 : 30}/></div>
    <div className={`${compact ? 'min-w-0 flex-1' : 'mt-4'}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{item.name}</p><p className="mt-1 text-xs text-[#806b60] dark:text-[#bba99f]">{frameworkLabel(item.framework)} · Updated {formatDate(item.updatedAt)}</p></div><button type="button" onClick={() => setMenu(value => !value)} aria-label={`Project actions for ${item.name}`} className="rounded-lg p-1.5 hover:bg-[#fff4ed] dark:hover:bg-white/10"><MoreHorizontal size={17}/></button></div><div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge label={status} tone={item.status === 'active' ? 'neutral' : 'warning'}/><span className="text-xs text-[#806b60] dark:text-[#bba99f]">Development</span>{item.status !== 'trashed' && <Link href={`/projects/${item.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[#b46743]">Open <ChevronRight size={14}/></Link>}</div></div>
    {menu && <div className="absolute right-3 top-12 z-20 w-44 rounded-xl border border-[#eadfd8] bg-white p-1.5 text-sm shadow-lg dark:border-white/10 dark:bg-[#27201c]">{item.status !== 'trashed' && <Link href={`/projects/${item.id}`} className="block rounded-lg px-3 py-2 hover:bg-[#fff4ed] dark:hover:bg-white/10">Open project</Link>}{item.status === 'active' && <><button type="button" onClick={() => { const name=window.prompt('Project name',item.name); if(name) mutate(() => renameProjectAction(item.id,name)) }} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#fff4ed] dark:hover:bg-white/10">Rename</button><button type="button" onClick={() => mutate(() => duplicateProjectAction(item.id))} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#fff4ed] dark:hover:bg-white/10">Duplicate</button><button type="button" onClick={() => mutate(() => archiveProjectAction(item.id))} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#fff4ed] dark:hover:bg-white/10">Archive</button></>}{item.status !== 'active' && <button type="button" onClick={() => mutate(() => restoreProjectAction(item.id))} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#fff4ed] dark:hover:bg-white/10">Restore</button>}{item.status !== 'trashed' && <button type="button" onClick={() => mutate(() => softDeleteProjectAction(item.id))} className="block w-full rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50">Move to trash</button>}{item.status === 'trashed' && <button type="button" disabled={pending} onClick={() => { if(window.confirm(`Permanently delete ${item.name}?`)) mutate(() => permanentlyDeleteProjectAction(item.id)) }} className="block w-full rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50">Delete forever</button>}</div>}
  </article>
}

function TemplatesWorkspace({ pending, run, router }: { pending: boolean; run: (action: () => Promise<void>) => void; router: ReturnType<typeof useRouter> }) {
  const categories = ['All','SaaS','Dashboard','E-Commerce','Landing Page','Portfolio','Mobile App','AI App','Marketplace','Internal Tool']
  const [category,setCategory]=useState('All'); const [query,setQuery]=useState('')
  const visible=TEMPLATE_CATALOG.filter(item => (category==='All'||item.category===category)&&`${item.title} ${item.category} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
  function createFromTemplate(id: string){run(async()=>{const project=await createTemplateProjectAction(id);router.push(`/projects/${project.id}`);router.refresh()})}
  return <><WorkspaceHeader title="Templates" subtitle="Start with complete, responsive sites built from real content and photography."/><label className="mt-7 flex max-w-xl items-center gap-2 rounded-xl border border-[#eadfd8] bg-white px-3 dark:border-white/10 dark:bg-white/5"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search templates" className="h-10 flex-1 bg-transparent text-sm outline-none"/></label><div className="mt-4 flex gap-2 overflow-x-auto pb-2">{categories.map(item=><button key={item} type="button" onClick={()=>setCategory(item)} aria-pressed={category===item} className="whitespace-nowrap rounded-full border border-[#eadfd8] px-3 py-1.5 text-xs aria-pressed:border-[#eaa27d] aria-pressed:bg-[#fff0e5] dark:border-white/10 dark:aria-pressed:bg-white/10">{item}</button>)}</div>{visible.length===0?<EmptyState title="No templates found" body="Try another search or category."/>:<div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map((template,index)=><article key={template.id} className="group overflow-hidden rounded-2xl border border-[#eadfd8] bg-white transition hover:-translate-y-0.5 hover:shadow-xl dark:border-white/10 dark:bg-white/5"><div className="relative h-52 overflow-hidden"><Image src={template.image} alt={template.imageAlt} fill loading={index<3?'eager':'lazy'} sizes="(min-width:1280px) 30vw,(min-width:768px) 45vw,100vw" className="object-cover transition duration-500 group-hover:scale-[1.03]"/><div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent"/><span className="absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[#53392c]">{template.category}</span></div><div className="p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{template.title}</h2><p className="mt-1 text-xs text-[#806b60] dark:text-[#bba99f]">{template.framework} · Responsive · 6 sections</p></div><Smartphone size={17} className="text-[#b87850]"/></div><p className="mt-3 text-sm leading-6 text-[#6d584d] dark:text-[#c8b8ae]">{template.description}</p><div className="mt-5 flex gap-2"><button type="button" onClick={()=>createFromTemplate(template.id)} disabled={pending} className="flex-1 rounded-xl bg-[#e98b66] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending?'Creating…':'Use Template'}</button><button type="button" onClick={()=>document.getElementById(`template-${template.id}`)?.showPopover()} className="rounded-xl border border-[#eadfd8] px-3 py-2 text-sm dark:border-white/10">Preview</button></div><div id={`template-${template.id}`} popover="auto" className="m-auto max-h-[90svh] w-[min(760px,calc(100vw-28px))] overflow-y-auto rounded-3xl border border-[#eadfd8] bg-white p-0 text-[#281f1a] shadow-2xl"><div className="relative h-72"><Image src={template.image} alt={template.imageAlt} fill sizes="760px" className="rounded-t-3xl object-cover"/><div className="absolute inset-0 rounded-t-3xl bg-gradient-to-t from-black/70 to-transparent"/><div className="absolute inset-x-6 bottom-6 text-white"><p className="text-xs font-bold uppercase tracking-[.16em]">{template.category}</p><h3 className="mt-2 text-3xl font-bold">{template.title}</h3></div></div><div className="p-6"><p className="text-sm leading-6 text-[#6d584d]">{template.description}</p><div className="mt-5 grid gap-2 sm:grid-cols-3">{template.features.map(feature=><span key={feature} className="rounded-xl bg-[#fff3eb] px-3 py-3 text-xs font-semibold">{feature}</span>)}</div><div className="mt-6 flex flex-wrap justify-between gap-3"><a href={template.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-[#806b60] underline">Photo source</a><div className="flex gap-2"><button type="button" popoverTarget={`template-${template.id}`} popoverTargetAction="hide" className="rounded-xl border border-[#eadfd8] px-4 py-2 text-sm">Close</button><button type="button" onClick={()=>createFromTemplate(template.id)} disabled={pending} className="rounded-xl bg-[#e98b66] px-4 py-2 text-sm font-semibold text-white">Use Template</button></div></div></div></div></div></article>)}</div>}</>
}

function DedicatedPreview({ projects }: { projects: DashboardProject[] }) {
  const [projectId,setProjectId]=useState(projects[0]?.id??''); const [html,setHtml]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null)
  const previewSession=useRef(globalThis.crypto.randomUUID())
  useEffect(()=>{if(!projectId)return;let active=true;buildProjectPreviewAction(projectId,0,previewSession.current).then(preview=>{if(active)setHtml(preview.html)}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'Preview unavailable.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[projectId])
  function selectProject(nextId:string){setProjectId(nextId);setHtml('');setError(null);setLoading(Boolean(nextId))}
  return <div className="-mx-4 -my-6 flex h-[calc(100svh-4rem)] flex-col sm:-mx-7 lg:-mx-10 lg:-my-9"><div className="flex flex-wrap items-center gap-3 border-b border-[#eadfd8] px-4 py-3 sm:px-7 dark:border-white/10"><div className="mr-auto"><h1 className="text-xl font-bold">Preview</h1><p className="text-xs text-[#806b60]">Inspect the current project without builder controls.</p></div><select aria-label="Preview project" value={projectId} onChange={event=>selectProject(event.target.value)} className="h-10 rounded-xl border border-[#eadfd8] bg-white px-3 text-sm dark:border-white/10 dark:bg-[#211b18]"><option value="">Select a project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>{projectId&&<Link href={`/projects/${projectId}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#eadfd8] px-3 text-sm dark:border-white/10">Open builder <ArrowUpRight size={15}/></Link>}</div><div className="min-h-0 flex-1 p-3">{loading?<div className="grid h-full place-items-center text-sm text-[#806b60]">Loading preview…</div>:error?<div role="alert" className="grid h-full place-items-center text-sm text-red-600">{error}</div>:html?<PreviewWorkbench html={html} initialDevice="desktop"/>:<EmptyState title="Select a project" body="Choose an active project to inspect its live responsive preview."/>}</div></div>
}

function DeployWorkspace({ projects }: { projects: DashboardProject[] }) {
  const [projectId,setProjectId]=useState(projects[0]?.id??'')
  return <><WorkspaceHeader title="Deploy" subtitle="Connect store accounts and prepare real mobile releases." actions={<select aria-label="Deployment project" value={projectId} onChange={event=>setProjectId(event.target.value)} className="h-10 rounded-xl border border-[#eadfd8] bg-white px-3 text-sm dark:border-white/10 dark:bg-[#211b18]"><option value="">Select project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>}/>{!projectId?<EmptyState title="Select a project" body="Choose a project to configure Apple and Google Play publishing."/>:<MobileDeploymentSettings key={projectId} projectId={projectId}/>}</>
}

function SettingsWorkspace({ projects, settings, setSettings, pending, run }: { projects: DashboardProject[]; settings: DashboardSettings; setSettings: (settings: DashboardSettings)=>void; pending:boolean; run:(action:()=>Promise<void>)=>void }) {
  const router=useRouter()
  const [tab,setTab]=useState('General'); const [projectId,setProjectId]=useState(projects[0]?.id??''); const [aiStatus,setAiStatus]=useState<AiProviderStatus|null>(null); const [provider,setProvider]=useState<AiProviderStatus['provider']>('vercel'); const [model,setModel]=useState('anthropic/claude-sonnet-4.5'); const [baseURL,setBaseURL]=useState(''); const [apiKey,setApiKey]=useState(''); const [revealed,setRevealed]=useState(false)
  useEffect(()=>{if(tab!=='Integrations'||aiStatus)return;getAiProviderStatusAction().then(status=>{setAiStatus(status);setProvider(status.provider);setModel(status.model);setBaseURL(status.baseURL)})},[aiStatus,tab])
  const current=projects.find(project=>project.id===projectId)
  function preference(input:Partial<DashboardSettings>){run(async()=>setSettings(await updateSettingsAction(input)))}
  return <><WorkspaceHeader title="Settings" subtitle="Manage workspace preferences, integrations, and project safety." actions={<select aria-label="Settings project" value={projectId} onChange={event=>setProjectId(event.target.value)} className="h-10 rounded-xl border border-[#eadfd8] bg-white px-3 text-sm dark:border-white/10 dark:bg-[#211b18]"><option value="">Workspace settings</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select>}/><div className="mt-7 grid gap-6 lg:grid-cols-[190px_minmax(0,760px)]"><nav className="flex gap-1 overflow-x-auto lg:grid lg:self-start">{['General','Appearance','Environment','Integrations','Deployment','Danger Zone'].map(item=><button key={item} type="button" onClick={()=>setTab(item)} aria-pressed={tab===item} className="whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm aria-pressed:bg-[#fff0e5] aria-pressed:font-semibold dark:aria-pressed:bg-white/10">{item}</button>)}</nav><div>
    {tab==='General'&&<Panel title="General"><div className="grid gap-4"><Field label="Project name"><input value={current?.name??''} disabled={!current||pending} onChange={()=>{}} readOnly className="input"/></Field><p className="text-xs text-[#806b60]">Rename the selected project from its Projects action menu. Framework and runtime are derived from the persisted project configuration.</p><InfoRow label="Framework" value={current ? frameworkLabel(current.framework) : 'No project selected'}/><InfoRow label="Default environment" value="Development"/></div></Panel>}
    {tab==='Appearance'&&<Panel title="Appearance"><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Theme" value={settings.theme} disabled={pending} onChange={value=>preference({theme:value as DashboardSettings['theme']})} options={['system','light','dark']}/><SelectField label="Default preview" value={settings.defaultDevice} disabled={pending} onChange={value=>preference({defaultDevice:value as DashboardSettings['defaultDevice']})} options={['phone','tablet','desktop']}/><SelectField label="Editor font size" value={String(settings.editorFontSize)} disabled={pending} onChange={value=>preference({editorFontSize:Number(value)})} options={['12','14','16','18','20','24']}/><SelectField label="Autosave interval" value={String(settings.autosaveInterval)} disabled={pending} onChange={value=>preference({autosaveInterval:Number(value)})} options={['5','15','30','60','300']}/></div></Panel>}
    {tab==='Environment'&&<Panel title="Environment variables"><div className="rounded-xl border border-dashed border-[#d9c7bc] p-6 text-center dark:border-white/15"><KeyRound className="mx-auto text-[#b87850]" size={22}/><p className="mt-3 text-sm font-semibold">Secure environment storage is not connected</p><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[#806b60]">Values are never placed in frontend source. Connect a deployment provider with encrypted secret storage before adding production variables.</p><button type="button" disabled className="mt-4 rounded-xl border px-3 py-2 text-sm opacity-50">Add variable</button></div></Panel>}
    {tab==='Integrations'&&<Panel title="Integrations"><IntegrationSettings/><div className="mt-5 rounded-xl border border-[#eadfd8] p-4 dark:border-white/10"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold">AI provider</p><p className="text-xs text-[#806b60]">{aiStatus?.configured?`Connected securely: ${aiStatus.provider}${aiStatus.keyHint?` ${aiStatus.keyHint}`:''}`:'Vercel Gateway is the current default.'}</p></div>{aiStatus?.configured&&<StatusBadge label="Connected" tone="success"/>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><SelectField label="Provider" value={provider} disabled={pending} onChange={value=>setProvider(value as AiProviderStatus['provider'])} options={['vercel','openai','anthropic','google','openrouter','custom']}/><Field label="Model"><input value={model} onChange={event=>setModel(event.target.value)} className="input"/></Field>{provider==='custom'&&<Field label="API base URL"><input value={baseURL} onChange={event=>setBaseURL(event.target.value)} className="input"/></Field>}{provider!=='vercel'&&<Field label="API key"><div className="flex gap-2"><input type={revealed?'text':'password'} value={apiKey} onChange={event=>setApiKey(event.target.value)} autoComplete="off" className="input flex-1" placeholder={aiStatus?.keyHint?`Saved ${aiStatus.keyHint}`:'Provider key'}/><button type="button" onClick={()=>setRevealed(value=>!value)} className="rounded-lg border px-3 text-xs">{revealed?'Hide':'Reveal'}</button></div></Field>}</div><div className="mt-4 flex gap-2"><button type="button" onClick={()=>run(async()=>{const result=await saveAiProviderAction({provider,model,baseURL,apiKey});if(!result.ok)throw new Error(result.error);setAiStatus(result.status);setApiKey('')})} disabled={pending} className="rounded-xl bg-[#e98b66] px-4 py-2 text-sm font-semibold text-white">Save provider</button>{aiStatus?.configured&&<button type="button" onClick={()=>run(async()=>setAiStatus(await clearAiProviderAction()))} className="rounded-xl border px-4 py-2 text-sm">Disconnect</button>}</div></div></Panel>}
    {tab==='Deployment'&&<Panel title="Deployment"><p className="text-sm text-[#806b60]">Deployment automation remains off until a real provider is connected.</p><div className="mt-5 space-y-3"><InfoRow label="Production branch" value="Not configured"/><InfoRow label="Automatic deployments" value="Off"/><InfoRow label="Preview deployments" value="Off"/><InfoRow label="Provider" value="Not connected"/></div></Panel>}
    {tab==='Danger Zone'&&<Panel title="Danger Zone" danger><p className="text-sm text-[#806b60]">Destructive actions require confirmation and remain scoped to the selected project.</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={!current} onClick={()=>current&&run(async()=>{await archiveProjectAction(current.id);router.push('/');router.refresh()})} className="rounded-xl border px-3 py-2 text-sm">Archive project</button><button type="button" disabled={!current} onClick={()=>{if(current&&window.confirm(`Move ${current.name} to trash?`))run(async()=>{await softDeleteProjectAction(current.id);router.push('/');router.refresh()})}} className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600">Delete project</button></div></Panel>}
  </div></div></>
}

function Panel({ title, children, danger=false }: { title:string; children:React.ReactNode; danger?:boolean }) { return <section className={`rounded-2xl border bg-white p-5 dark:bg-white/5 ${danger?'border-red-200 dark:border-red-900':'border-[#eadfd8] dark:border-white/10'}`}><h2 className="text-lg font-semibold">{title}</h2><div className="mt-4">{children}</div></section> }
function StatusBadge({label,tone}:{label:string;tone:'neutral'|'success'|'warning'}) { return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone==='success'?'bg-emerald-50 text-emerald-700':tone==='warning'?'bg-amber-50 text-amber-700':'bg-[#f5eee9] text-[#6e594e] dark:bg-white/10 dark:text-[#d6c6bd]'}`}><CircleDot size={9}/>{label}</span> }
function InfoRow({label,value}:{label:string;value:string}) { return <div className="flex items-center justify-between gap-4 border-b border-[#f0e5de] py-2.5 text-sm last:border-0 dark:border-white/10"><span className="text-[#806b60] dark:text-[#bba99f]">{label}</span><span className="text-right font-medium">{value}</span></div> }
function EmptyState({title,body,action,onAction}:{title:string;body:string;action?:string;onAction?:()=>void}) { return <div className="mt-7 rounded-2xl border border-dashed border-[#d9c7bc] px-6 py-12 text-center dark:border-white/15"><Folder className="mx-auto text-[#b87850]" size={24}/><h2 className="mt-3 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm text-[#806b60] dark:text-[#bba99f]">{body}</p>{action&&onAction&&<button type="button" onClick={onAction} className="mt-5 rounded-xl bg-[#e98b66] px-4 py-2 text-sm font-semibold text-white">{action}</button>}</div> }
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="grid gap-1.5 text-sm font-medium">{label}{children}</label> }
function SelectField({label,value,options,disabled,onChange}:{label:string;value:string;options:string[];disabled:boolean;onChange:(value:string)=>void}) { return <Field label={label}><select value={value} disabled={disabled} onChange={event=>onChange(event.target.value)} className="input capitalize">{options.map(option=><option key={option} value={option}>{option}</option>)}</select></Field> }
