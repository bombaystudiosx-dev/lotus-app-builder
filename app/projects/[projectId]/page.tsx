import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getUserSettings, getWorkspace } from '@/app/actions/projects'
import LotusBuilder from '@/components/lotus/builder'

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const { projectId } = await params
  const [workspace, settings] = await Promise.all([getWorkspace(projectId), getUserSettings()])
  if (!workspace) notFound()

  return <main className="h-svh w-full overflow-hidden">
    <LotusBuilder initial={{
      projectId: workspace.projectId,
      name: workspace.name,
      html: workspace.html,
      messages: workspace.messages,
      userName: session.user.name || session.user.email || 'You',
      editorFontSize: settings.editorFontSize,
      defaultDevice: settings.defaultDevice,
      theme: settings.theme,
      files: workspace.files,
      entryPath: workspace.entryPath,
      runtime: workspace.runtime,
    }} />
  </main>
}
