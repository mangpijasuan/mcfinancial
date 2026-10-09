import Link from 'next/link'
import StatementView from '@/components/statements/StatementView'

// A member's statement exactly as the member sees it, for answering their questions.
export default async function MemberStatements({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href={`/members/${id}`} className="inline-flex min-h-6 items-center text-sm text-indigo-700 underline">← Back to the member</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Statements</h1>
        <p className="text-sm text-gray-500 mt-0.5">What this member sees in the portal, from the club&apos;s ledger.</p>
      </div>
      <StatementView api={`/api/members/${encodeURIComponent(id)}/statements`} />
    </div>
  )
}
