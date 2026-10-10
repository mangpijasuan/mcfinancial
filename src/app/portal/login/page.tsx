'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Lock } from 'lucide-react'
import { APP_NAME } from '@/lib/brand'
import { button, field } from '@/components/portal/kit'

export default function PortalLoginPage() {
  const router = useRouter()
  const [memberId, setMemberId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await signIn('member', { memberId: memberId.trim().toUpperCase(), password, redirect: false })
    if (res?.ok) {
      router.push('/portal/dashboard')
    } else {
      setError('Invalid Member ID or password. Contact your admin if you need access.')
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-navy bg-[radial-gradient(120%_80%_at_50%_0%,#2d4475_0%,#1b2a4a_60%,#121d35_100%)]">
      <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <img src="/brand/mc-logo-on-dark.svg" alt="" className="mx-auto mb-5 h-14 w-24 object-contain" />
            <h1 className="text-2xl font-semibold tracking-tight text-white">{APP_NAME}</h1>
            <p className="mt-1 text-sm text-white/80">Sign in to your member account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 rounded-3xl bg-white p-6 shadow-2xl shadow-black/20 sm:p-8">
            <div className="space-y-1.5">
              <label htmlFor="memberId" className="block text-sm font-medium text-gray-800">Member ID</label>
              <input
                id="memberId" type="text" autoComplete="username" value={memberId} onChange={e => setMemberId(e.target.value)} required
                placeholder="e.g. MC-10001" autoCapitalize="characters" spellCheck={false}
                className={`${field} uppercase placeholder:normal-case`}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-gray-800">Password</label>
              <input
                id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
                className={field}
              />
            </div>
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-600/15">{error}</p>}
            <button type="submit" disabled={loading} className={`${button.primary} w-full min-h-11`}>
              {loading ? 'Signing in…' : <>Sign in <ArrowRight size={16} aria-hidden /></>}
            </button>
            <p className="flex items-start justify-center gap-1.5 text-center text-xs text-gray-500">
              <Lock size={12} className="mt-0.5 shrink-0" aria-hidden /> Forgot your password? A club officer can reset it for you.
            </p>
          </form>

          <p className="mt-6 text-center text-sm text-white/80">
            Club staff? <a href="/login" className="inline-flex min-h-6 items-center font-medium text-white underline-offset-4 hover:underline">Staff sign-in</a>
          </p>
        </div>
      </main>
    </div>
  )
}
