'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, PageHeader, Button, Input, Badge, Modal } from '@/components/ui'
import { useStaff } from '@/components/staff/StaffContext'

type RoleDef = { key: string; label: string; description: string; permissions: string[]; privileged: boolean; transitional: boolean }
type StaffRow = {
  id: string; email: string; name: string; roles: string[]; roleLabels: string[]
  disabled: boolean; mfaEnabled: boolean; lastLoginAt: string | null; linkedMemberId: string | null; createdAt: string
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, data }
}

function RolePicker({ roles, value, onChange, canGrantPrivileged }: {
  roles: RoleDef[]; value: string[]; onChange: (v: string[]) => void; canGrantPrivileged: boolean
}) {
  return (
    <div className="space-y-2">
      {roles.map((r) => {
        const locked = r.privileged && !canGrantPrivileged
        return (
          <label key={r.key} className={`flex gap-3 rounded-lg border p-3 ${value.includes(r.key) ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200'} ${locked ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
              type="checkbox" className="mt-1" disabled={locked} checked={value.includes(r.key)}
              onChange={(e) => onChange(e.target.checked ? [...value, r.key] : value.filter((k) => k !== r.key))}
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">
                {r.label}{r.transitional && <span className="ml-2 text-xs font-normal text-amber-700">transitional</span>}
              </span>
              <span className="block text-xs text-gray-500">{r.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

export default function StaffPage() {
  const { staff: me, can } = useStaff()
  const canManage = can('staff.manage')
  const isSuperAdmin = Boolean(me?.roleLabels.includes('Super Admin'))

  const [rows, setRows] = useState<StaffRow[]>([])
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', email: '', password: '', roles: [] as string[] })
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [editRoles, setEditRoles] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/staff', { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    setLoading(false)
    if (!res.ok) return setError(data?.error || 'Unable to load staff accounts.')
    setRows(data.staff)
    setRoles(data.roles)
  }, [])
  useEffect(() => { load() }, [load])

  function done(ok: boolean, text: string) {
    setMessage(ok ? text : '')
    setError(ok ? '' : text)
    if (ok) load()
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const { ok, data } = await send('/api/staff', 'POST', form)
    if (!ok) return done(false, data?.error || 'Unable to create the account.')
    setForm({ name: '', email: '', password: '', roles: [] })
    setShowCreate(false)
    done(true, `Account created for ${data.email}. They will set up two-factor authentication at first sign-in.`)
  }

  async function saveRoles() {
    if (!editing) return
    const { ok, data } = await send(`/api/staff/${editing.id}`, 'PATCH', { roles: editRoles })
    setEditing(null)
    done(ok, ok ? `Roles updated for ${data.email}. The change applies immediately.` : data?.error || 'Unable to update roles.')
  }

  async function act(row: StaffRow, action: 'password' | 'mfa' | 'sessions' | 'disable' | 'enable') {
    if (action === 'password') {
      const password = window.prompt(`New password for ${row.email} (12+ characters). They will be signed out everywhere.`)
      if (!password) return
      const { ok, data } = await send(`/api/staff/${row.id}`, 'PATCH', { password })
      return done(ok, ok ? 'Password reset; all their sessions ended.' : data?.error || 'Unable to reset the password.')
    }
    if (action === 'mfa') {
      if (!window.confirm(`Reset two-factor authentication for ${row.email}? They will set it up again at next sign-in. Only do this after confirming who is asking.`)) return
      const { ok, data } = await send(`/api/staff/${row.id}/reset-mfa`, 'POST')
      return done(ok, ok ? 'Two-factor authentication reset; all their sessions ended.' : data?.error || 'Unable to reset.')
    }
    if (action === 'sessions') {
      const { ok, data } = await send(`/api/staff/${row.id}/revoke-sessions`, 'POST')
      return done(ok, ok ? `Signed out ${data.revoked} session(s).` : data?.error || 'Unable to sign out.')
    }
    const disabled = action === 'disable'
    if (disabled && !window.confirm(`Disable ${row.email}? They are signed out at once and cannot sign in.`)) return
    const { ok, data } = await send(`/api/staff/${row.id}`, 'PATCH', { disabled })
    done(ok, ok ? (disabled ? 'Account disabled.' : 'Account re-enabled.') : data?.error || 'Unable to update the account.')
  }

  const isSelf = (row: StaffRow) => row.email === me?.email
  const lockedFor = (row: StaffRow) => isSelf(row) || (row.roles.includes('super_admin') && !isSuperAdmin)

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <PageHeader
        title="Staff & Roles"
        sub="What each person can do comes from their roles. Changes apply on their next click; every change is in the audit log."
        action={canManage ? <Button onClick={() => setShowCreate(true)}>Add staff</Button> : undefined}
      />

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {rows.some((r) => r.roles.includes('club_officer')) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Some accounts still have the transitional <strong>Club Officer</strong> role (the access every admin had before roles).
          Replace it with specific roles once the officers are named.
        </p>
      )}

      <div className="space-y-3">
        {loading && rows.length === 0 && <Card className="p-5 text-sm text-gray-500">Loading…</Card>}
        {!loading && rows.length === 0 && <Card><p className="py-16 text-center text-gray-400 text-sm">No staff accounts.</p></Card>}
        {rows.map((row) => (
          <Card key={row.id} className={`p-4 ${row.disabled ? 'opacity-60' : ''}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  {row.name} {isSelf(row) && <span className="text-xs text-gray-400">(you)</span>}
                </p>
                <p className="text-sm text-gray-500 break-all">{row.email}{row.linkedMemberId ? ` · member ${row.linkedMemberId}` : ''}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.roleLabels.length ? row.roleLabels.map((l) => <Badge key={l} variant="blue">{l}</Badge>) : <Badge variant="gray">No roles</Badge>}
                  {row.disabled && <Badge variant="red">Disabled</Badge>}
                  <Badge variant={row.mfaEnabled ? 'green' : 'amber'}>{row.mfaEnabled ? '2FA on' : '2FA not set up'}</Badge>
                </div>
                <p className="mt-1 text-xs text-gray-400">
                  Last sign-in: {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'never'}
                </p>
              </div>
              {canManage && !lockedFor(row) && (
                <div className="flex flex-wrap gap-2 md:justify-end md:max-w-sm">
                  <Button size="sm" variant="secondary" onClick={() => { setEditing(row); setEditRoles(row.roles) }}>Roles</Button>
                  <Button size="sm" variant="secondary" onClick={() => act(row, 'password')}>Reset password</Button>
                  {row.mfaEnabled && <Button size="sm" variant="secondary" onClick={() => act(row, 'mfa')}>Reset 2FA</Button>}
                  <Button size="sm" variant="secondary" onClick={() => act(row, 'sessions')}>Sign out</Button>
                  {row.disabled
                    ? <Button size="sm" variant="secondary" onClick={() => act(row, 'enable')}>Enable</Button>
                    : <Button size="sm" variant="danger" onClick={() => act(row, 'disable')}>Disable</Button>}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h2 className="font-semibold text-gray-900">Roles</h2>
        <p className="mt-1 text-sm text-gray-500">Defined in the architecture (D-07). No role approves its own proposals; Super Admin is for emergencies.</p>
        <div className="mt-3 divide-y divide-gray-100">
          {roles.map((r) => (
            <details key={r.key} className="py-2">
              <summary className="cursor-pointer text-sm font-medium text-gray-900">
                {r.label} <span className="font-normal text-gray-500">— {r.description}</span>
              </summary>
              <p className="mt-2 text-xs text-gray-600 wrap-break-word">{r.permissions.join(' · ')}</p>
            </details>
          ))}
        </div>
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add staff account">
        <form onSubmit={create} className="space-y-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input label="Temporary password (12+ characters)" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <p className="text-sm font-medium text-gray-700">Roles</p>
          <RolePicker roles={roles} value={form.roles} onChange={(v) => setForm({ ...form, roles: v })} canGrantPrivileged={isSuperAdmin} />
          <Button type="submit" className="w-full">Create account</Button>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Roles for ${editing.name}` : ''}>
        <div className="space-y-3">
          <RolePicker roles={roles} value={editRoles} onChange={setEditRoles} canGrantPrivileged={isSuperAdmin} />
          <Button className="w-full" onClick={saveRoles}>Save roles</Button>
        </div>
      </Modal>
    </div>
  )
}
