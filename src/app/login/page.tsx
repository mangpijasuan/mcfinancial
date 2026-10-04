'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { APP_NAME } from '@/lib/brand'

const inputClass =
  'w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('admin', { email, password, code: needsCode ? code : '', redirect: false })
    if (res?.ok && !res.error) {
      router.push('/start')
      return
    }
    setLoading(false)
    if (res?.error === 'MFA_REQUIRED') {
      setNeedsCode(true)
      return
    }
    if (res?.error === 'MFA_INVALID') {
      setCode('')
      setError('That code did not work. Use the newest code from your app, or a recovery code.')
      return
    }
    setNeedsCode(false)
    setCode('')
    setError('Invalid email or password')
  }

  return (
    <div className="min-h-screen bg-[#1B2A4A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/mc-logo.png" alt={APP_NAME} className="inline-block w-28 h-16 mb-4 object-contain" />
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="text-white/50 text-sm mt-1">Staff sign-in</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-2xl space-y-4">
          {!needsCode ? (
            <>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required
                  className={inputClass} placeholder="you@mcfinancial.local"
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
                  className={inputClass} placeholder="••••••••"
                />
              </div>
            </>
          ) : (
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">Authentication code</label>
              <p className="text-xs text-gray-500 mb-2">
                Enter the 6-digit code from your authenticator app, or one of your recovery codes.
              </p>
              <input
                id="code" autoFocus autoComplete="one-time-code" inputMode="text" value={code}
                onChange={e => setCode(e.target.value)} required
                className={`${inputClass} tracking-widest text-center text-lg`} placeholder="123456"
              />
              <button
                type="button"
                onClick={() => { setNeedsCode(false); setCode(''); setError('') }}
                className="mt-2 text-xs text-indigo-600 hover:underline"
              >
                ← Use a different account
              </button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-[#1B2A4A] hover:bg-[#243660] text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60 mt-2"
          >
            {loading ? 'Signing in…' : needsCode ? 'Verify' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-gray-400 pt-1">
            Member?{' '}
            <a href="/portal/login" className="text-indigo-600 hover:underline">Member portal →</a>
          </p>
        </form>
      </div>
    </div>
  )
}
