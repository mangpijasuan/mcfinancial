'use client'
import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Edit2, FileText, KeyRound, Globe, Shield } from 'lucide-react'
import { Card, Table, Badge, StatusBadge, EligibleBadge, RiskBadge, LoanStatusBadge,
         Button, Modal, Input, Select, Spinner } from '@/components/ui'
import { fmt$, fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'
import DuesPanel from '@/components/contributions/DuesPanel'

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)
  const [member, setMember] = useState<any>(null)
  const [showEdit, setShowEdit] = useState(false)
  const [showPortal, setShowPortal] = useState(false)
  const [showPromoteAdmin, setShowPromoteAdmin] = useState(false)
  const { can } = useStaff()
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        const res = await fetch(`/api/members/${id}`)
        const data = await readJsonSafe(res)
        if (!res.ok || !data) throw new Error('Failed to load member details.')
        setMember(data)
      } catch (err: any) {
        setError(err?.message || 'Failed to load member details.')
      }
    })()
  }, [id])

  if (error) return <div className="p-8"><div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div></div>

  if (!member) return <div className="p-8"><Spinner /></div>

  const years = member.yearlyTotals || []

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => router.push('/members')}><ArrowLeft size={15} /> Back</Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{member.legalName}</h1>
            <p className="text-sm text-gray-500">{member.id} {member.nickname && `· "${member.nickname}"`}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:shrink-0">
          {can('staff.manage') && (
            <Button variant="secondary" size="sm" onClick={() => setShowPromoteAdmin(true)}><Shield size={14} /> {member.linkedAdmin ? 'Staff account' : 'Give staff access'}</Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => router.push(`/members/${encodeURIComponent(member.id)}/statements`)}><FileText size={14} /> Statements</Button>
          {can('members.portal_access') && <Button variant="secondary" size="sm" onClick={() => setShowPortal(true)}><KeyRound size={14} /> Portal access</Button>}
          {can('members.update') && <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}><Edit2 size={14} /> Edit</Button>}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoBox label="Status"><StatusBadge status={member.status} /></InfoBox>
        <InfoBox label="Joined">{fmtDate(member.joinDate)}</InfoBox>
        <InfoBox label="Months active">{member.monthsActive}</InfoBox>
        <InfoBox label="Risk"><RiskBadge risk={member.riskFlag} /></InfoBox>
        <InfoBox label="Archive contributions">{fmt$(member.archiveLifetime)}</InfoBox>
        <InfoBox label="2026 contributions">{fmt$(member.contributions2026)}</InfoBox>
        <InfoBox label="Max loan amount">{fmt$(member.maxLoanAmount)}</InfoBox>
        <InfoBox label="Eligible"><EligibleBadge eligible={member.eligible} /></InfoBox>
        <InfoBox label="Loan balance">{member.currentLoanBalance > 0 ? fmt$(member.currentLoanBalance) : '—'}</InfoBox>
        <InfoBox label="This month"><Badge variant={member.thisMonth === 'PAID' ? 'green' : 'red'}>{member.thisMonth}</Badge></InfoBox>
        <InfoBox label="Phone">{member.phoneNo || '—'}</InfoBox>
        <InfoBox label="Email">{member.email || '—'}</InfoBox>
        {can('staff.read') && <>
          <InfoBox label="Staff access">
            {member.linkedAdmin
              ? <Badge variant={member.linkedAdmin.disabled ? 'gray' : 'blue'}>{member.linkedAdmin.disabled ? 'Disabled' : member.linkedAdmin.roleLabel}</Badge>
              : '—'}
          </InfoBox>
          <InfoBox label="Staff sign-in email">{member.linkedAdmin?.email || '—'}</InfoBox>
        </>}
      </div>

      {can('contributions.read') && <DuesPanel memberId={member.id} canChangePlan={can('dues.manage_plans')} />}

      {/* Payment history by year */}
      {years.length > 0 && (
        <Card className="mb-6 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Payment history by year</h2>
          <div className="flex flex-wrap gap-3">
            {years.map((y: any) => (
              <div key={y.year} className="flex flex-col items-center bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 min-w-[70px]">
                <span className="text-xs text-gray-500 font-medium">{y.year}</span>
                <span className="text-sm font-bold text-gray-800">{fmt$(y.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent contributions */}
      <Card className="mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Contribution records (2026)</h2>
        </div>
        <Table headers={['Receipt', 'Paid on', 'Applied to', 'Amount', 'Method', 'Received by', 'Comments']}>
          {member.contributions.length === 0
            ? <tr><td colSpan={7} className="py-10 text-center text-sm text-gray-400">No contributions.</td></tr>
            : member.contributions.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                  {c.receiptNumber ? <a className="text-indigo-600 underline" href={`/contributions/${c.transactionId}/receipt`}>{c.receiptNumber}</a> : <span className="text-gray-400">{c.transactionId}</span>}
                </td>
                <td className="px-4 py-2.5 text-gray-600 text-xs whitespace-nowrap">{fmtDate(c.paymentDate)}</td>
                <td className="px-4 py-2.5 text-gray-600 text-xs">{c.reversedAt ? <Badge variant="red">Reversed</Badge> : c.category === 'voluntary' ? 'Voluntary' : (c.receiptCovers || '—')}</td>
                <td className={`px-4 py-2.5 font-semibold ${c.reversedAt ? 'text-gray-400 line-through' : 'text-green-700'}`}>{fmt$(c.amount)}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{c.paymentMethod || '—'}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{c.receivedBy || '—'}</td>
                <td className="px-4 py-2.5 text-gray-400 text-xs">{c.comments || '—'}</td>
              </tr>
            ))
          }
        </Table>
      </Card>

      {/* Loans */}
      {member.loansAsBorrower.length > 0 && (
        <Card>
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Loans</h2>
          </div>
          {member.loansAsBorrower.map((loan: any) => (
            <div key={loan.id} className="p-5 border-b border-gray-100 last:border-0">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-mono text-xs text-indigo-600 mr-2">{loan.loanId}</span>
                  <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
                </div>
                <span className="text-lg font-bold text-gray-900">{fmt$(loan.balanceRemaining)} remaining</span>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <InfoBox label="Loan amount">{fmt$(loan.loanAmount)}</InfoBox>
                <InfoBox label="Monthly due">{fmt$(loan.monthlyDue)}</InfoBox>
                <InfoBox label="Total paid">{fmt$(loan.totalPaid)}</InfoBox>
                <InfoBox label="Next due">{fmtDate(loan.nextDueDate)}</InfoBox>
              </div>
              {loan.payments.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Payment history</p>
                  <div className="space-y-1">
                    {loan.payments.map((p: any) => (
                      <div key={p.id} className="flex justify-between text-xs text-gray-600">
                        <span>{fmtDate(p.paymentDate)} · {p.paymentId}</span>
                        <span className="font-semibold">{fmt$(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Historical Loans */}
      {(member.historicalLoansAsBorrower?.length > 0 || member.historicalLoansAsCosigner?.length > 0) && (
        <Card className="mt-6">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Historical loans (2021–2025)</h2>
          </div>

          {member.historicalLoansAsBorrower?.length > 0 && (
            <div className="p-5 border-b border-gray-100 last:border-0">
              <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">As borrower</p>
              <Table headers={['Loan ID', 'Year', 'Co-signer', 'Loan date', 'Amount', 'Paid', 'Balance', 'Status']}>
                {member.historicalLoansAsBorrower.map((l: any) => (
                  <tr key={`hb-${l.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-indigo-600">{l.loanId}</td>
                    <td className="px-4 py-2.5 text-gray-700 text-xs">{l.year}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{l.cosignerName || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(l.loanDate)}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{fmt$(l.loanAmount)}</td>
                    <td className="px-4 py-2.5 text-green-700 font-medium">{fmt$(l.totalPaid)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{l.balanceRemaining > 0 ? fmt$(l.balanceRemaining) : '—'}</td>
                    <td className="px-4 py-2.5"><LoanStatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {member.historicalLoansAsCosigner?.length > 0 && (
            <div className="p-5">
              <p className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">As co-signer</p>
              <Table headers={['Loan ID', 'Year', 'Borrower', 'Loan date', 'Amount', 'Paid', 'Balance', 'Status']}>
                {member.historicalLoansAsCosigner.map((l: any) => (
                  <tr key={`hc-${l.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-indigo-600">{l.loanId}</td>
                    <td className="px-4 py-2.5 text-gray-700 text-xs">{l.year}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{l.borrowerName}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(l.loanDate)}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-900">{fmt$(l.loanAmount)}</td>
                    <td className="px-4 py-2.5 text-green-700 font-medium">{fmt$(l.totalPaid)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{l.balanceRemaining > 0 ? fmt$(l.balanceRemaining) : '—'}</td>
                    <td className="px-4 py-2.5"><LoanStatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      <EditMemberModal open={showEdit} onClose={() => setShowEdit(false)} member={member}
        onSaved={(updated: any) => { setMember({ ...member, ...updated }); setShowEdit(false) }} />
      <PortalModal open={showPortal} onClose={() => setShowPortal(false)} member={member}
        onSaved={(updated: any) => { setMember({ ...member, ...updated }); setShowPortal(false) }} />
      <PromoteAdminModal
        open={showPromoteAdmin}
        onClose={() => setShowPromoteAdmin(false)}
        member={member}
        onSaved={(updated: any) => { setMember({ ...member, linkedAdmin: updated.admin }); setShowPromoteAdmin(false) }}
      />
    </div>
  )
}

function InfoBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3 border border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <div className="text-sm font-medium text-gray-900">{children}</div>
    </div>
  )
}

function EditMemberModal({ open, onClose, member, onSaved }: any) {
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (member) setForm({ legalName: member.legalName, nickname: member.nickname || '', status: member.status, phoneNo: member.phoneNo || '', email: member.email || '', beneficiary: member.beneficiary || '', notes: member.notes || '', riskFlag: member.riskFlag })
  }, [member])

  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: e.target.value }))

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const res = await fetch(`/api/members/${member.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) { onSaved(await res.json()) } else setSaving(false)
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit — ${member?.legalName}`}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><Input label="Legal name" value={form.legalName || ''} onChange={set('legalName')} required /></div>
          <Input label="Nickname" value={form.nickname || ''} onChange={set('nickname')} />
          <Select label="Status" value={form.status || ''} onChange={set('status')}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
          <Input label="Phone" value={form.phoneNo || ''} onChange={set('phoneNo')} />
          <Input label="Email" value={form.email || ''} onChange={set('email')} />
          <Select label="Risk flag" value={form.riskFlag || ''} onChange={set('riskFlag')}>
            <option value="LOW">LOW</option>
            <option value="HIGH">HIGH</option>
          </Select>
          <Input label="Beneficiary" value={form.beneficiary || ''} onChange={set('beneficiary')} />
          <div className="col-span-2"><Input label="Notes" value={form.notes || ''} onChange={set('notes')} /></div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  )
}

async function readJsonSafe(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function PortalModal({ open, onClose, member, onSaved }: any) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')

  const isEnabled = member?.portalEnabled

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (password && password !== confirm) { setError('Passwords do not match.'); return }
    if (password && password.length < 8)  { setError('Password must be at least 8 characters.'); return }
    setSaving(true); setError('')
    const res = await fetch(`/api/members/${member.id}/set-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password || undefined, enabled: true }),
    })
    if (res.ok) { onSaved(await res.json()) }
    else { setError((await res.json().catch(() => null))?.error || 'Failed to save.'); setSaving(false) }
  }

  async function disable() {
    setSaving(true)
    await fetch(`/api/members/${member.id}/set-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    onSaved({ portalEnabled: false })
  }

  return (
    <Modal open={open} onClose={onClose} title={`Portal access — ${member?.legalName}`}>
      <div className="space-y-4">
        <div className={`rounded-xl p-4 flex items-center gap-3 ${isEnabled ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
          <Globe size={18} className={isEnabled ? 'text-green-600' : 'text-gray-400'} />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              Portal access is currently <span className={isEnabled ? 'text-green-700' : 'text-gray-500'}>{isEnabled ? 'enabled' : 'disabled'}</span>
            </p>
            <p className="text-xs text-gray-500">Login URL: <span className="font-mono">/portal/login</span> · Member ID: <span className="font-mono">{member?.id}</span></p>
          </div>
        </div>

        <form onSubmit={save} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{isEnabled ? 'Set new password (leave blank to keep current)' : 'Set password to enable access'}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="New password"
              required={!isEnabled}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Confirm password</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm password"
              required={!isEnabled || !!password}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between pt-2">
            {isEnabled && (
              <Button variant="danger" size="sm" type="button" onClick={disable} disabled={saving}>Disable access</Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : isEnabled ? 'Update password' : 'Enable access'}</Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function PromoteAdminModal({ open, onClose, member, onSaved }: any) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [catalogue, setCatalogue] = useState<{ key: string; label: string; description: string; privileged: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setPassword('')
    setConfirm('')
    setRoles([])
    setError('')
    setSaving(false)
    fetch('/api/staff', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setCatalogue((d?.roles ?? []).filter((r: any) => !r.privileged && !r.transitional)))
      .catch(() => setCatalogue([]))
  }, [open])

  async function promote(e: React.FormEvent) {
    e.preventDefault()
    if (member?.linkedAdmin) return setError('This member already has a staff account.')
    if (!member?.email) return setError('Member needs an email address first.')
    if (password.length < 12) return setError('Password must be at least 12 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    if (roles.length === 0) return setError('Choose at least one role.')

    setSaving(true)
    setError('')
    const res = await fetch(`/api/members/${member.id}/promote-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, roles }),
    })
    const data = await readJsonSafe(res)
    if (res.ok && data) {
      onSaved(data)
      return
    }
    setError(data?.error || 'Failed to create the staff account.')
    setSaving(false)
  }

  return (
    <Modal open={open} onClose={onClose} title={`Staff access — ${member?.legalName}`}>
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-900">Creates a separate staff sign-in linked to this member.</p>
          <p className="mt-1 text-xs text-gray-500">Member ID: <span className="font-mono">{member?.id}</span> · Email: <span className="font-mono">{member?.email || 'missing'}</span></p>
          {member?.linkedAdmin && (
            <p className="mt-2 text-xs text-blue-700">Already linked to {member.linkedAdmin.email} ({member.linkedAdmin.roleLabel}). Manage it under Staff &amp; Roles.</p>
          )}
        </div>

        {!member?.linkedAdmin && (
          <form onSubmit={promote} className="space-y-3">
            <p className="text-sm font-medium text-gray-700">Roles</p>
            <div className="space-y-2">
              {catalogue.map((r) => (
                <label key={r.key} className="flex gap-3 rounded-lg border border-gray-200 p-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={roles.includes(r.key)}
                    onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((k) => k !== r.key))} />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{r.label}</span>
                    <span className="block text-xs text-gray-500">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <Input label="Temporary password (12+ characters)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            <p className="text-xs text-gray-500">They will set up two-factor authentication at first sign-in.</p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create staff account'}</Button>
            </div>
          </form>
        )}

        {member?.linkedAdmin && (
          <div className="flex justify-end">
            <Button variant="secondary" type="button" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
