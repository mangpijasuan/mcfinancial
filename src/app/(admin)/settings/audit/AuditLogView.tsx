'use client'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { Card, Table, EmptyState, Badge, Button, PageHeader, Select, FilterBar, SearchInput } from '@/components/ui'

type Entry = {
  id: string
  at: string
  actorType: 'admin' | 'member' | 'system' | 'anonymous'
  actorId: string | null
  actorLabel: string | null
  action: string
  entityType: string
  entityId: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  ip: string | null
}

const ACTION_GROUPS = [
  { value: '', label: 'All actions' },
  { value: 'payment.', label: 'Payments' },
  { value: 'contribution.', label: 'Contributions' },
  { value: 'loan', label: 'Loans & repayments' },
  { value: 'agreement.', label: 'Agreements' },
  { value: 'withdrawal.', label: 'Withdrawals' },
  { value: 'member.', label: 'Members' },
  { value: 'admin.', label: 'Admin accounts' },
  { value: 'auth.', label: 'Sign-ins' },
  { value: 'notifications.', label: 'Notifications' },
]

const actorVariant: Record<Entry['actorType'], 'green' | 'amber' | 'gray' | 'red'> = {
  admin: 'green', member: 'amber', system: 'gray', anonymous: 'red',
}

const IGNORED_FIELDS = new Set(['updatedAt'])

function show(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Field-level changes between before and after snapshots. */
function changes(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return []
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
  return keys
    .filter((k) => !IGNORED_FIELDS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => ({ field: k, from: before[k], to: after[k] }))
}

function summary(e: Entry) {
  const diff = changes(e.before, e.after)
  if (diff.length) return diff.map((d) => d.field).join(', ')
  if (e.after && !e.before) return 'created'
  if (e.before && !e.after) return 'removed'
  return ''
}

function EntryDetails({ e }: { e: Entry }) {
  const diff = changes(e.before, e.after)
  return (
    <>
      {diff.length > 0 ? (
        <ul className="space-y-1">
          {diff.map((c) => (
            <li key={c.field} className="break-all">
              <span className="font-medium text-gray-800">{c.field}</span>:{' '}
              <span className="text-red-700 line-through">{show(c.from)}</span>{' → '}
              <span className="text-green-700">{show(c.to)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <pre className="whitespace-pre-wrap break-all text-gray-700">{JSON.stringify(e.after ?? e.before ?? {}, null, 2)}</pre>
      )}
      {e.metadata && (
        <pre className="mt-2 whitespace-pre-wrap break-all text-gray-500">{JSON.stringify(e.metadata, null, 2)}</pre>
      )}
      <p className="mt-2 text-gray-400">Entry #{e.id}{e.ip ? ` · IP ${e.ip}` : ''}</p>
    </>
  )
}

export default function AuditLogView() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [entityId, setEntityId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor?: string) => {
    const p = new URLSearchParams()
    if (action) p.set('action', action)
    if (actor) p.set('actor', actor)
    if (entityId) p.set('entityId', entityId)
    if (cursor) p.set('cursor', cursor)
    const res = await fetch(`/api/audit?${p}`)
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) throw new Error(data?.error || 'Failed to load the audit log.')
    return data as { entries: Entry[]; nextCursor: string | null }
  }, [action, actor, entityId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const t = setTimeout(() => {
      fetchPage()
        .then((data) => { if (!cancelled) { setEntries(data.entries); setNextCursor(data.nextCursor) } })
        .catch((err) => { if (!cancelled) { setEntries([]); setError(err.message) } })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [fetchPage])

  async function loadMore() {
    if (!nextCursor) return
    setLoading(true)
    try {
      const data = await fetchPage(nextCursor)
      setEntries((prev) => [...prev, ...data.entries])
      setNextCursor(data.nextCursor)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Audit Log"
        sub="Every change to members, money and access, with who made it. Entries cannot be edited or deleted."
      />

      <FilterBar>
        <Select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          {ACTION_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
        </Select>
        <SearchInput value={actor} onChange={setActor} placeholder="Who (email or member ID)…" />
        <SearchInput value={entityId} onChange={setEntityId} placeholder="Record ID (exact)…" />
      </FilterBar>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {/* Mobile: one card per entry */}
      <div className="md:hidden space-y-3">
        {entries.length === 0 && !loading && (
          <Card className="px-4 py-12 text-center text-sm text-gray-400">
            No audit entries match.
          </Card>
        )}
        {entries.map((e) => (
          <Card key={e.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-gray-900 break-all">{e.action}</p>
                <p className="text-xs text-gray-500 mt-0.5">{new Date(e.at).toLocaleString()}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setOpen(open === e.id ? null : e.id)}>
                {open === e.id ? 'Hide' : 'Details'}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={actorVariant[e.actorType]}>{e.actorType}</Badge>
              <span className="text-gray-700 break-all">{e.actorLabel || e.actorId || '—'}</span>
            </div>
            <p className="mt-1 text-xs">
              <span className="text-gray-400">{e.entityType} </span>
              <span className="font-mono text-indigo-600 break-all">{e.entityId}</span>
              {summary(e) && <span className="text-gray-500"> · {summary(e)}</span>}
            </p>
            {open === e.id && <div className="mt-3 border-t border-gray-100 pt-3 text-xs"><EntryDetails e={e} /></div>}
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <Table loading={loading && entries.length === 0} headers={['When', 'Who', 'Action', 'Record', 'Changed', '']}>
          {entries.length === 0 && !loading
            ? <EmptyState message="No audit entries match." />
            : entries.map((e) => (
              <Fragment key={e.id}>
                <tr className="hover:bg-gray-50 transition-colors align-top">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={actorVariant[e.actorType]}>{e.actorType}</Badge>
                      <span className="text-xs text-gray-700 wrap-break-word min-w-40">{e.actorLabel || e.actorId || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-900 whitespace-nowrap">{e.action}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="text-gray-400">{e.entityType} </span>
                    <span className="font-mono text-indigo-600 break-all">{e.entityId}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[220px] truncate">{summary(e)}</td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="secondary" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      {open === e.id ? 'Hide' : 'Details'}
                    </Button>
                  </td>
                </tr>
                {open === e.id && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="px-4 py-3 text-xs">
                      <EntryDetails e={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))
          }
        </Table>
      </Card>

      {nextCursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" disabled={loading} onClick={loadMore}>Load older entries</Button>
        </div>
      )}
    </div>
  )
}
