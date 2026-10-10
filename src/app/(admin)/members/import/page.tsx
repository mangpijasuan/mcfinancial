import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import ImportView from '@/components/staff/ImportView'

export default async function MembersImportPage() {
  if (!can(await getPrincipal(), 'members.create')) redirect('/start')
  return <ImportView kind="members" />
}
