import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getWorkspace } from '@/app/actions/projects'
import LotusBuilder from '@/components/lotus/builder'

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const ws = await getWorkspace()

  return (
    <main className="h-svh w-full overflow-hidden">
      <LotusBuilder
        initial={{
          projectId: ws.projectId,
          name: ws.name,
          html: ws.html,
          messages: ws.messages,
          userName: session.user.name || session.user.email || 'You',
        }}
      />
    </main>
  )
}
