import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import DataExportView from './DataExportView'

export default async function DataExportPage() {
  if (!can(await getPrincipal(), 'data.export')) redirect('/start')
  return <DataExportView />
}
