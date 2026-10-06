import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import { todayIso } from '@/lib/dates'
import ReportsView from './ReportsView'

export default async function ReportsPage() {
  const principal = await getPrincipal()
  if (!can(principal, 'ledger.read')) redirect('/start')
  return <ReportsView today={todayIso()} />
}
