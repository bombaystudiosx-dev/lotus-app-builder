import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getProjectDashboard } from '@/app/actions/projects'
import { ProjectDashboard } from '@/components/lotus/project-dashboard'

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const dashboard = await getProjectDashboard()

  return (
    <ProjectDashboard
      initialProjects={dashboard.projects}
      initialSettings={dashboard.settings}
      userName={session.user.name || session.user.email || 'You'}
    />
  )
}
