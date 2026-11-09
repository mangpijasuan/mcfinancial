import { redirect } from 'next/navigation'
import { can, getPrincipal } from '@/modules/auth'
import BulkUploadView from '@/components/staff/BulkUploadView'
import { BULK_UPLOADS, IMPORT_SETUPS } from '@/components/staff/importSetups'

// Every spreadsheet upload the signed-in person may use, on one page.
export default async function BulkUploadPage() {
  const principal = await getPrincipal()
  const kinds = BULK_UPLOADS.filter((kind) => can(principal, IMPORT_SETUPS[kind].permission))
  if (kinds.length === 0) redirect('/start')
  return <BulkUploadView kinds={kinds} />
}
