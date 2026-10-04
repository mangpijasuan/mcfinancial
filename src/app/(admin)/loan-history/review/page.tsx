import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import ReviewView from './ReviewView'

export default async function LinkOlderLoansPage() {
  const principal = await getPrincipal()
  if (!can(principal, 'loans.read')) redirect('/start')
  return <ReviewView canLink={can(principal, 'loans.link_history')} />
}
