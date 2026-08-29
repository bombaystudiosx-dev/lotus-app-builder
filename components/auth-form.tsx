'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import Image from 'next/image'
import { Check, Eye, EyeOff } from 'lucide-react'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignUp = mode === 'sign-up'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)

    const { error } = isSignUp
      ? await authClient.signUp.email({ email: email.trim().toLowerCase(), password, name: name.trim() })
      : await authClient.signIn.email({ email: email.trim().toLowerCase(), password })

    setLoading(false)

    if (error) {
      setError(isSignUp ? (error.message ?? 'Unable to create this account.') : 'The email or password is incorrect.')
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <main className="grid min-h-svh place-items-center bg-[#fffaf7] px-4 py-10 text-[#281f1a]">
      <Card className="grid w-full max-w-4xl overflow-hidden border-[#eadfd8] bg-white p-0 shadow-[0_24px_80px_rgba(72,45,31,.12)] md:grid-cols-[.9fr_1.1fr]">
        <section className="hidden bg-[#241b16] p-10 text-white md:flex md:flex-col">
          <Image src="/logo_lotus.png" alt="Lotus App Builder" width={112} height={112} className="h-28 w-28 object-contain" priority/>
          <h2 className="mt-8 text-3xl font-bold tracking-tight">Your ideas belong in your workspace.</h2>
          <p className="mt-4 text-sm leading-6 text-white/65">Every project, template, connection, and deployment setting stays isolated to your account.</p>
          <ul className="mt-auto grid gap-4 pt-12 text-sm">{['Private project ownership','Secure HTTP-only sessions','Seven-day session continuity'].map(item=><li key={item} className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#ef916a] text-white"><Check size={14}/></span>{item}</li>)}</ul>
        </section>
        <section className="p-6 sm:p-10">
          <div className="mb-7 md:hidden"><Image src="/logo_lotus.png" alt="Lotus App Builder" width={80} height={80} className="h-20 w-20 object-contain" priority/></div>
          <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {isSignUp ? 'Create an account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSignUp
              ? 'Create your private Lotus workspace.'
              : 'Sign in to continue building.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                className="h-10 bg-[var(--input-background)] border-[rgba(44,34,20,0.18)]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              className="h-10 bg-[var(--input-background)] border-[rgba(44,34,20,0.18)]"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              className="h-10 bg-[var(--input-background)] border-[rgba(44,34,20,0.18)]"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            /><button type="button" onClick={()=>setShowPassword(value=>!value)} className="self-end text-xs font-medium text-[#8a5a43]" aria-label={showPassword?'Hide password':'Show password'}>{showPassword?<><EyeOff className="mr-1 inline" size={14}/>Hide</>:<><Eye className="mr-1 inline" size={14}/>Show</>}</button>
          </div>
          {isSignUp && <div className="flex flex-col gap-2"><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" className="h-10 bg-[var(--input-background)] border-[rgba(44,34,20,0.18)]" type={showPassword?'text':'password'} value={confirmPassword} onChange={(event)=>setConfirmPassword(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password"/></div>}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? 'Please wait...'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <Link
            href={isSignUp ? '/sign-in' : '/sign-up'}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </Link>
        </p>
        </section>
      </Card>
    </main>
  )
}
