'use client'
import { useEffect, useState } from 'react'
import { formatUSD, type Cents } from '@/lib/money'
import { fmtDate } from '@/lib/utils'

type ReceiptData = {
  transactionId: string
  receiptNumber: string | null
  memberId: string
  memberName: string
  paymentDate: string
  recordedAt: string
  amountCents: Cents
  category: string
  paymentMethod: string | null
  receivedBy: string | null
  covers: string | null
  reversed: { at: string; reason: string | null } | null
}

/** A numbered receipt for one contribution, laid out to print on one page. */
export default function Receipt({ id, backHref }: { id: string; backHref: string }) {
  const [data, setData] = useState<ReceiptData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/contributions/${id}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || !body) throw new Error(body?.error || 'Could not load the receipt.')
        setData(body)
      })
      .catch((err: Error) => setError(err.message))
  }, [id])

  if (error) return <p role="alert" className="p-6 text-sm text-red-700">{error}</p>
  if (!data) return <p className="p-6 text-sm text-gray-500">Loading…</p>

  const rows: [string, string][] = [
    ['Member', `${data.memberName} (${data.memberId})`],
    ['Paid on', fmtDate(data.paymentDate)],
    ['Method', data.paymentMethod || '—'],
    ...(data.receivedBy ? [['Received by', data.receivedBy] as [string, string]] : []),
    ['Applied to', data.covers || (data.category === 'voluntary' ? 'Voluntary contribution' : '—')],
    ['Recorded', fmtDate(data.recordedAt)],
    ['Reference', data.transactionId],
  ]

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-8">
      <div className="mb-4 flex justify-between gap-2 print:hidden">
        <a href={backHref} className="text-sm text-indigo-700 underline">← Back</a>
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">Print</button>
      </div>
      <article className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs print:border-none print:shadow-none">
        <header className="flex items-center gap-3 border-b border-gray-100 pb-4">
          <img src="/brand/mc-logo.svg" alt="" width={72} height={39} />
          <div className="min-w-0">
            <p className="font-bold text-gray-900">Millionaires Club</p>
            <p className="text-xs text-gray-500">Contribution receipt</p>
          </div>
          <p className="ml-auto font-mono text-sm text-gray-700">{data.receiptNumber ?? '—'}</p>
        </header>
        {data.reversed && (
          <p role="status" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Reversed on {fmtDate(data.reversed.at)}: {data.reversed.reason}. This payment no longer counts.
          </p>
        )}
        <p className="mt-5 text-3xl font-bold tabular-nums text-gray-900">{formatUSD(data.amountCents)}</p>
        <dl className="mt-4 divide-y divide-gray-100 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
              <dt className="w-32 shrink-0 text-gray-500">{label}</dt>
              <dd className="wrap-break-word text-gray-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-xs text-gray-400">Dues pay the oldest unpaid month first. Keep this receipt for your records.</p>
      </article>
    </div>
  )
}
