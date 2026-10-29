'use client'
import { PageHeader } from '@/components/ui'
import type { ImportKind } from '@/modules/data/import'
import { ImportPanel } from './ImportView'

const GROUPS: { title: string; kinds: ImportKind[] }[] = [
  { title: 'Contributions', kinds: ['contributions', 'contribution_reversals'] },
  { title: 'Loans', kinds: ['loan_payments'] },
  { title: 'Members', kinds: ['members'] },
]

/**
 * Bulk Upload: each spreadsheet upload as a card with its sample file.
 * Every upload is previewed first and saves all its rows or none
 * (docs/operations/data-import.md).
 */
export default function BulkUploadView({ kinds }: { kinds: ImportKind[] }) {
  return (
    <div className="p-4 sm:p-8">
      <PageHeader
        title="Bulk Upload"
        sub="Add or correct many records at once from a spreadsheet saved as CSV. Download a sample file, fill it in, and upload it: the preview shows what would happen, row by row, before anything is saved."
      />
      <div className="space-y-8">
        {GROUPS.map((group) => {
          const shown = group.kinds.filter((k) => kinds.includes(k))
          if (shown.length === 0) return null
          return (
            <section key={group.title} aria-labelledby={`bulk-${group.title}`}>
              <h2 id={`bulk-${group.title}`} className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{group.title}</h2>
              <div className="space-y-4">
                {shown.map((kind) => <ImportPanel key={kind} kind={kind} heading="h3" showColumns={false} />)}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
