'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { APP_NAME } from '@/lib/brand'

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
    <div className="min-h-screen bg-[#1B2A4A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/brand/mc-logo-on-dark.svg" alt={APP_NAME} className="inline-block w-28 h-16 mb-4 object-contain" />
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="text-white/50 text-sm mt-1">Member Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-2xl space-y-4">
          <div>
            <label htmlFor="memberId" className="block text-sm font-medium text-gray-700 mb-1">Member ID</label>
            <input
              id="memberId" type="text" autoComplete="username" value={memberId} onChange={e => setMemberId(e.target.value)} required
              placeholder="e.g. MC-10001"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 uppercase"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-[#1B2A4A] hover:bg-[#243660] text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60 mt-2"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-gray-400 pt-1">
            Admin?{' '}
            <a href="/login" className="text-indigo-600 hover:underline">Sign in here</a>
          </p>
        </form>
      </div>
    </div>
  )
}
