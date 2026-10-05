'use client'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import RecoveryCodes from '@/components/staff/RecoveryCodes'

type Setup = { secret: string; qrDataUrl: string }

export default function MfaEnrolment({ name, email }: { name: string; email: string }) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/me/mfa/setup', { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) return setError(data?.error || 'Could not start setup.')
    setSetup(data)
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await fetch('/api/me/mfa/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim() }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) return setError(data?.error || 'Could not verify the code.')
    setCodes(data.recoveryCodes)
  }

  return (
    <div className="min-h-screen bg-[#1B2A4A] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <img src="/brand/mc-logo.svg" alt="" className="w-16 h-10 object-contain" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">Set up two-factor authentication</h1>
            <p className="text-xs text-gray-500">{name} · {email}</p>
          </div>
        </div>

        {codes ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Two-factor authentication is on.</p>
            <RecoveryCodes codes={codes} />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I have saved my recovery codes
            </label>
            <button
              disabled={!saved}
              onClick={() => { window.location.href = '/start' }}
              className="w-full rounded-xl bg-[#1B2A4A] py-2.5 text-sm font-semibold text-white hover:bg-[#243660] disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        ) : !setup ? (
          <div className="space-y-4 text-sm text-gray-700">
            <p>
              Staff accounts need a second step at sign-in: a 6-digit code from an authenticator app on your phone
              (Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar all work).
            </p>
            <p>It takes about a minute. Have your phone ready.</p>
            <button
              onClick={start} disabled={busy}
              className="w-full rounded-xl bg-[#1B2A4A] py-2.5 font-semibold text-white hover:bg-[#243660] disabled:opacity-60"
            >
              {busy ? 'Preparing…' : 'Start setup'}
            </button>
          </div>
        ) : (
          <form onSubmit={verify} className="space-y-4 text-sm text-gray-700">
            <p><strong>1.</strong> In your authenticator app, add an account and scan this code:</p>
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="mx-auto h-44 w-44" />
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Can’t scan? Enter this key instead</summary>
              <p className="mt-2 break-all rounded-sm bg-gray-50 p-2 font-mono text-gray-800">{setup.secret}</p>
            </details>
            <div>
              <label htmlFor="code" className="block"><strong>2.</strong> Enter the 6-digit code it shows:</label>
              <input
                id="code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-lg tracking-widest focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                placeholder="123456" required
              />
            </div>
            <button
              type="submit" disabled={busy || code.length !== 6}
              className="w-full rounded-xl bg-[#1B2A4A] py-2.5 font-semibold text-white hover:bg-[#243660] disabled:opacity-60"
            >
              {busy ? 'Checking…' : 'Turn on two-factor authentication'}
            </button>
          </form>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {!codes && (
          <button onClick={() => signOut({ callbackUrl: '/login' })} className="mt-6 w-full text-center text-xs text-gray-400 hover:text-gray-600">
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
