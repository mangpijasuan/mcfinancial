'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle, Download, FileUp } from 'lucide-react'
import { Button, Card, PageHeader } from '@/components/ui'
import { fmtDate } from '@/lib/utils'
import type { ImportPreview, RowResult } from '@/modules/data/import'

type Kind = 'members' | 'contributions'

const SETUP: Record<Kind, { title: string; back: string; backLabel: string; intro: string; columns: { name: string; note: string }[]; template: string }> = {
  members: {
    title: 'Import members',
    back: '/members', backLabel: 'Members',
    intro: 'Add new members, or update the contact details of existing ones, from a spreadsheet saved as CSV. A Members file downloaded from Data Export can be edited and imported back.',
    columns: [
      { name: 'Member ID', note: 'Empty for a new member (the app gives the next number); the ID for an update.' },
      { name: 'Legal name', note: 'Required for a new member. Names of existing members are changed in the app, not by import.' },
      { name: 'Joined', note: 'Required for a new member: YYYY-MM-DD or M/D/YYYY.' },
      { name: 'Nickname, Phone, Email, Beneficiary', note: 'Optional. An empty cell leaves the detail as it is: an import never erases.' },
    ],
    template: 'Member ID,Legal name,Joined,Nickname,Phone,Email,Beneficiary\r\n,Jane Example,2026-10-01,,555-0100,jane@example.com,\r\n',
  },
  contributions: {
    title: 'Import contributions',
    back: '/contributions', backLabel: 'Contributions',
    intro: 'Record a batch of contributions from a spreadsheet saved as CSV. Each one is recorded exactly as if typed in: receipt, monthly dues and the ledger.',
    columns: [
      { name: 'Member ID', note: 'Required, e.g. MC-10001.' },
      { name: 'Paid on', note: 'Required: YYYY-MM-DD or M/D/YYYY. Not in the future.' },
      { name: 'Amount', note: 'Required, in dollars: 20 or 20.00 or $1,200.50.' },
      { name: 'Method, Kind, Received by, Note', note: 'Optional. Kind is "dues" (the default) or "voluntary".' },
    ],
    template: 'Member ID,Paid on,Amount,Method,Kind,Received by,Note\r\nMC-10001,2026-10-05,20.00,Zelle,dues,,\r\n',
  },
}

const ACTION: Record<RowResult['action'], { label: string; className: string }> = {
  add: { label: 'Add', className: 'bg-green-100 text-green-800' },
  update: { label: 'Update', className: 'bg-blue-100 text-blue-800' },
  unchanged: { label: 'No change', className: 'bg-gray-100 text-gray-700' },
  error: { label: 'Error', className: 'bg-red-100 text-red-800' },
}

/**
 * Two steps: preview (saves nothing), then import (all rows, or none).
 * Used for members and for contributions (docs/operations/data-import.md).
 */
export default function ImportView({ kind }: { kind: Kind }) {
  const setup = SETUP[kind]
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ publicId: string; added: number; updated: number } | null>(null)

  async function choose(f: File | undefined) {
    setPreview(null); setError(''); setDone(null)
    if (!f) { setFile(null); return }
    const csv = await f.text()
    setFile({ name: f.name, csv })
    setBusy(true)
    const res = await fetch(`/api/data/import/${kind}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'The file could not be read.'); return }
    setPreview(data)
  }

  async function run() {
    if (!file || !preview) return
    setBusy(true); setError('')
    const res = await fetch(`/api/data/import/${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: file.csv, fileHash: preview.fileHash, fileName: file.name }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'The import did not work. Nothing was saved.'); return }
    setDone(data)
    setPreview(null)
    setFile(null)
    if (input.current) input.current.value = ''
  }

  const c = preview?.counts
  const toSave = c ? c.add + c.update : 0
  const blocked = !!preview && (c!.error > 0 || toSave === 0 || !!preview.alreadyImported)

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title={setup.title}
        sub={setup.intro}
        action={<Link href={setup.back} className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">← {setup.backLabel}</Link>}
      />

      <Card className="mb-6 p-5">
        <h2 className="text-sm font-semibold text-gray-800">The spreadsheet’s first row names the columns</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
          {setup.columns.map((col) => (
            <div key={col.name} className="contents">
              <dt className="font-medium text-gray-900">{col.name}</dt>
              <dd className="text-gray-600">{col.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-gray-500">Other columns are ignored. In Excel or Google Sheets, save with File → Download / Save as → CSV.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(setup.template)}`} download={`${kind}-import-template.csv`}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
            <Download size={14} aria-hidden /> Template
          </a>
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-[#1B2A4A] px-4 text-sm font-semibold text-white hover:bg-[#243660] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#1B2A4A]">
            <FileUp size={15} aria-hidden /> Choose a CSV file
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file to import" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
          {file && <span className="text-sm text-gray-600">{file.name}</span>}
          {busy && <span className="text-sm text-gray-500">Checking…</span>}
        </div>
      </Card>

      {error && <p role="alert" className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {done && (
        <p role="status" className="mb-6 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle size={16} aria-hidden /> Imported ({done.publicId}): {done.added} added{kind === 'members' ? `, ${done.updated} updated` : ''}.
          {' '}<Link href={setup.back} className="underline">See {setup.backLabel.toLowerCase()}</Link>
        </p>
      )}

      {preview && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Preview: nothing has been saved yet</h2>
              <p className="mt-0.5 text-sm text-gray-600">
                {c!.add} to add{kind === 'members' ? ` · ${c!.update} to update · ${c!.unchanged} unchanged` : ''} · <span className={c!.error ? 'font-semibold text-red-700' : ''}>{c!.error} with errors</span>
                {c!.warnings > 0 && <> · {c!.warnings} to check</>}
              </p>
            </div>
            <Button onClick={run} disabled={busy || blocked}>
              {kind === 'members' ? `Import ${toSave} ${toSave === 1 ? 'member' : 'members'}` : `Record ${toSave} ${toSave === 1 ? 'contribution' : 'contributions'}`}
            </Button>
          </div>
          {preview.alreadyImported && (
            <p role="alert" className="mx-5 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This file was already imported ({preview.alreadyImported.publicId}, {fmtDate(preview.alreadyImported.at)}). Importing it again is not allowed.
            </p>
          )}
          {c!.error > 0 && <p className="mx-5 mt-4 text-sm text-red-700">Fix the rows with errors in the spreadsheet, save it as CSV again, and choose it again. Nothing is imported while any row has an error.</p>}
          {preview.ignoredColumns.length > 0 && <p className="mx-5 mt-3 text-xs text-gray-500">Ignored columns: {preview.ignoredColumns.join(', ')}.</p>}
          <ul className="mt-2 divide-y divide-gray-100">
            {preview.rows.map((r) => (
              <li key={r.line} className="flex gap-3 px-5 py-3 text-sm">
                <span className="w-14 shrink-0 text-xs text-gray-500">Line {r.line}</span>
                <span className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION[r.action].className}`}>{ACTION[r.action].label}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-gray-900">{r.summary}</p>
                  {r.changes?.map((ch) => <p key={ch.field} className="text-xs text-gray-600">{ch.field}: {ch.from || '(empty)'} → <strong>{ch.to}</strong></p>)}
                  {r.errors.map((m) => <p key={m} className="text-xs text-red-700">{m}</p>)}
                  {r.warnings.map((m) => <p key={m} className="flex items-start gap-1 text-xs text-amber-800"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden /> {m}</p>)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
