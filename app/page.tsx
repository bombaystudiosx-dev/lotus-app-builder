import { getProjectDashboard } from '@/app/actions/projects'
import { ProjectDashboard } from '@/components/lotus/project-dashboard'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const dashboard = await getProjectDashboard()

  return (
    <ProjectDashboard
      initialProjects={dashboard.projects}
      initialSettings={dashboard.settings}
      userName="Guest"
    />
  )
}
