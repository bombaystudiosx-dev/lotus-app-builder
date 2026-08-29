import { notFound, redirect } from 'next/navigation'
import { getUserSettings, getWorkspace } from '@/app/actions/projects'
import LotusBuilder from '@/components/lotus/builder'
import { getCurrentSession } from '@/lib/auth-session'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const session = await getCurrentSession()
  if (!session) redirect('/sign-in')
  const [workspace, settings] = await Promise.all([getWorkspace(projectId), getUserSettings()])
  if (!workspace) notFound()

  return <main className="h-svh w-full overflow-hidden">
    <LotusBuilder initial={{
      projectId: workspace.projectId,
      name: workspace.name,
      html: workspace.html,
      messages: workspace.messages,
      userName: session.user.name,
      editorFontSize: settings.editorFontSize,
      defaultDevice: settings.defaultDevice,
      theme: settings.theme,
      files: workspace.files,
      entryPath: workspace.entryPath,
      runtime: workspace.runtime,
    }} />
  </main>
}
