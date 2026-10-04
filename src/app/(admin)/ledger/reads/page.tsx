import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import ReadsView from './ReadsView'

export default async function LedgerReadsPage() {
  const principal = await getPrincipal()
  if (!can(principal, 'ledger.read')) redirect('/start')
  return <ReadsView />
}
