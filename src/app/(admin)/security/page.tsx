'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, PageHeader, Button, Input, Badge } from '@/components/ui'
import RecoveryCodes from '@/components/staff/RecoveryCodes'
import { useStaff } from '@/components/staff/StaffContext'

type SessionRow = { current: boolean; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null }

async function post(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, data }
}

export default function SecurityPage() {
  const { staff } = useStaff()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const [codeForRegen, setCodeForRegen] = useState('')
  const [newCodes, setNewCodes] = useState<string[] | null>(null)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' })

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/me/sessions', { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (res.ok) setSessions(data.sessions ?? [])
  }, [])
  useEffect(() => { loadSessions() }, [loadSessions])

  function flash(ok: boolean, text: string) {
    setMessage(ok ? text : '')
    setError(ok ? '' : text)
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault()
    const { ok, data } = await post('/api/me/mfa/recovery-codes', { code: codeForRegen.trim() })
    setCodeForRegen('')
    if (!ok) return flash(false, data?.error || 'Could not create new codes.')
    setNewCodes(data.recoveryCodes)
    flash(true, 'New recovery codes created. The old ones no longer work.')
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pw.newPassword !== pw.confirm) return flash(false, 'The new passwords do not match.')
    const { ok, data } = await post('/api/me/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
    if (!ok) return flash(false, data?.error || 'Could not change the password.')
    setPw({ currentPassword: '', newPassword: '', confirm: '' })
    flash(true, `Password changed.${data.otherSessionsRevoked ? ` Signed out ${data.otherSessionsRevoked} other session(s).` : ''}`)
    loadSessions()
  }

  async function signOutOthers() {
    const { ok, data } = await post('/api/me/sessions', undefined, 'DELETE')
    if (!ok) return flash(false, data?.error || 'Could not sign out other sessions.')
    flash(true, `Signed out ${data.revoked} other session(s).`)
    loadSessions()
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl space-y-6">
      <PageHeader title="My Security" sub={staff ? `${staff.name} · ${staff.email}` : undefined} />

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Card className="p-5">
        <h2 className="font-semibold text-gray-900">Your access</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {staff?.roleLabels.length ? staff.roleLabels.map((r) => <Badge key={r} variant="blue">{r}</Badge>) : <span className="text-sm text-gray-500">No roles assigned — ask an administrator.</span>}
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">Two-factor authentication</h2>
          <Badge variant="green">On</Badge>
        </div>
        {newCodes ? (
          <RecoveryCodes codes={newCodes} />
        ) : (
          <form onSubmit={regenerate} className="space-y-3">
            <p className="text-sm text-gray-600">
              Lost your recovery codes, or used some? Create a new set. Enter a current code from your authenticator app to confirm.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Authenticator code" inputMode="numeric" maxLength={6} placeholder="123456"
                value={codeForRegen} onChange={(e) => setCodeForRegen(e.target.value.replace(/\D/g, ''))}
              />
              <Button type="submit" variant="secondary" disabled={codeForRegen.length !== 6}>New recovery codes</Button>
            </div>
          </form>
        )}
        <p className="text-xs text-gray-500">Changed phones? Ask a staff administrator to reset your two-factor authentication; you will set it up again at your next sign-in.</p>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold text-gray-900">Change password</h2>
        <form onSubmit={changePassword} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
          <Input label="New password (12+)" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
          <Input label="Repeat new password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
          <div className="sm:col-span-3"><Button type="submit">Change password</Button></div>
        </form>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">Where you are signed in</h2>
          <Button variant="secondary" size="sm" onClick={signOutOthers} disabled={sessions.filter((s) => !s.current).length === 0}>
            Sign out everywhere else
          </Button>
        </div>
        <ul className="mt-3 divide-y divide-gray-100 text-sm">
          {sessions.map((s, i) => (
            <li key={i} className="py-2">
              <p className="text-gray-800 wrap-break-word">
                {s.userAgent || 'Unknown device'} {s.current && <Badge variant="green">This device</Badge>}
              </p>
              <p className="text-xs text-gray-500">
                Signed in {new Date(s.createdAt).toLocaleString()} · last active {new Date(s.lastSeenAt).toLocaleString()}{s.ip ? ` · ${s.ip}` : ''}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">Staff sessions end after 12 hours, or after 30 minutes without activity.</p>
      </Card>
    </div>
  )
}
