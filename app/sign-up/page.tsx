import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { getCurrentSession } from '@/lib/auth-session'

export default async function SignUpPage() {
  if (await getCurrentSession()) redirect('/')
  return <AuthForm mode="sign-up"/>
}
