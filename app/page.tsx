import { getProjectDashboard } from '@/app/actions/projects'
import { ProductShell } from '@/components/lotus/product-shell'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const dashboard = await getProjectDashboard()
  const requestedSection = (await searchParams).section
  const initialSection = ['projects', 'templates', 'preview', 'deploy', 'settings'].includes(requestedSection ?? '')
    ? requestedSection as 'projects' | 'templates' | 'preview' | 'deploy' | 'settings'
    : 'projects'

  return (
    <ProductShell
      initialProjects={dashboard.projects}
      initialSettings={dashboard.settings}
      userName="Guest"
      initialSection={initialSection}
    />
  )
}
