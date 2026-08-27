import Link from 'next/link'
import { ArrowLeft, Code2, Monitor, Rocket, Sparkles } from 'lucide-react'

const guides = [
  { icon: Sparkles, title: 'Generate an app', body: 'Open a project, describe the result you want in the composer, then review the generated application in Live Preview.' },
  { icon: Monitor, title: 'Test responsive layouts', body: 'Switch between Phone, Tablet, Desktop, or exact custom dimensions. Fit changes presentation scale without changing the real viewport.' },
  { icon: Code2, title: 'Edit project files', body: 'Use the Code workspace to update persisted project files. Preview builds continue to run inside the restricted Lotus iframe.' },
  { icon: Rocket, title: 'Prepare deployment', body: 'Review deployment readiness in Deploy. Lotus only reports a live status after a real provider successfully publishes the project.' },
]

export default function DocsPage() {
  return <main className="min-h-svh bg-[#fffdfb] px-5 py-8 text-[#281f1a] sm:px-8 lg:px-14 lg:py-12">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#8a604a]"><ArrowLeft size={16}/>Back to Lotus</Link>
      <p className="mt-12 text-xs font-semibold uppercase tracking-[.16em] text-[#c27852]">Lotus documentation</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">Build, inspect, and manage your applications.</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-[#766055]">A concise guide to the working Lotus product surfaces. Your projects and preferences remain persisted in the current workspace.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">{guides.map(guide => { const Icon=guide.icon; return <section key={guide.title} className="rounded-2xl border border-[#eadfd8] bg-white p-6"><Icon size={21} className="text-[#c27852]"/><h2 className="mt-5 text-lg font-semibold">{guide.title}</h2><p className="mt-2 text-sm leading-6 text-[#766055]">{guide.body}</p></section> })}</div>
    </div>
  </main>
}
