import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import ImportView from '@/components/staff/ImportView'

export default async function ContributionsImportPage() {
  if (!can(await getPrincipal(), 'contributions.record')) redirect('/start')
  return <ImportView kind="contributions" />
}
