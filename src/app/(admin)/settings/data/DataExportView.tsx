'use client'
import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileSpreadsheet, RefreshCw } from 'lucide-react'
import { Button, Card, PageHeader } from '@/components/ui'
import { fmtDate } from '@/lib/utils'
import { EXPORTS, EXPORT_KEYS } from '@/modules/data/exportTables'

type Status = { configured: boolean; serviceAccount: string | null; url: string | null; lastExportAt: string | null }

/**
 * Downloads of the club's records as spreadsheets, and the read-only Google
 * Sheets copy (docs/operations/data-export.md).
 */
export default function DataExportView() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/data/sheets').then((r) => r.json()).then(setStatus).catch(() => setStatus(null))
  }, [])

  async function copyNow() {
    setBusy(true); setMessage(null)
    const res = await fetch('/api/data/sheets', { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setMessage({ ok: false, text: data?.error ?? 'The copy did not work. Please try again.' }); return }
    setStatus(data.status)
    setMessage({ ok: true, text: `Copied: ${data.result.tabs.map((t: { title: string; rows: number }) => `${t.title} (${t.rows})`).join(', ')}.` })
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Data Export"
        sub="The club’s records as spreadsheets, to open in Excel, Numbers or Google Sheets. They include members’ personal details: keep them private."
      />

      <Card className="mb-6">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-800">Download a spreadsheet</h2>
          <p className="mt-0.5 text-xs text-gray-500">A CSV file of the records as they are now. Each download is recorded in the audit log.</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {EXPORT_KEYS.map((key) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{EXPORTS[key].title}</p>
                <p className="text-xs text-gray-500">{EXPORTS[key].description}</p>
              </div>
              <a
                href={`/api/data/export/${key}`} download
                aria-label={`Download ${EXPORTS[key].title} (CSV)`}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                <Download size={14} aria-hidden /> CSV
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={20} className="mt-0.5 shrink-0 text-green-700" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Google Sheets copy</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Every table in one Google Sheet, refreshed each night. It is a read-only copy: its tabs are locked, and nothing typed in it reaches the app.
              </p>
            </div>
            {status === null ? null : !status.configured ? (
              <p className="text-sm text-gray-600">
                Not set up on this server yet: it needs a Google service account and a spreadsheet shared with it. See <code>docs/operations/data-export.md</code>.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-700">
                  {status.lastExportAt ? <>Last copied {fmtDate(status.lastExportAt)}, {new Date(status.lastExportAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.</> : 'Not copied yet.'}
                  {' '}Written by <span className="font-mono text-xs">{status.serviceAccount}</span>.
                </p>
                <div className="flex flex-wrap gap-2">
                  {status.url && (
                    <a href={status.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                      Open the sheet <ExternalLink size={14} aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                  <Button size="sm" onClick={copyNow} disabled={busy}><RefreshCw size={14} aria-hidden /> {busy ? 'Copying…' : 'Copy now'}</Button>
                </div>
              </>
            )}
            {message && <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{message.text}</p>}
          </div>
        </div>
      </Card>
    </div>
  )
}
