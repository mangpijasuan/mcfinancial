import StatementView from '@/components/statements/StatementView'

export default function PortalStatements() {
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-gray-900">Statements</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your accounts with the club for a month or a year, from the club&apos;s ledger.</p>
      </div>
      <StatementView api="/api/portal/statements" historyHref="/portal/history" />
    </div>
  )
}
