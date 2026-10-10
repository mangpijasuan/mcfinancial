import StatementView from '@/components/statements/StatementView'
import { PageHeader } from '@/components/portal/kit'

export default function PortalStatements() {
  return (
    <div className="space-y-6">
      <PageHeader title="Statements" sub="Your accounts with the club for a month or a year, from the club's ledger." />
      <StatementView api="/api/portal/statements" historyHref="/portal/history" />
    </div>
  )
}
