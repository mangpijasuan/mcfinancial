import { redirect } from 'next/navigation'
import PortalNav from '@/components/portal/PortalNav'
import { getPrincipal } from '@/modules/auth'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Checked against the database: portal access switched off, or a
  // password change, ends the session here and in every portal API.
  const principal = await getPrincipal()
  if (!principal) redirect('/portal/login')
  if (principal.kind !== 'member') redirect('/start')

  return (
    <div className="min-h-screen bg-[#f6f7fb] print:bg-white">
      <div className="contents print:hidden"><PortalNav user={{ memberId: principal.memberId, name: principal.name }} /></div>
      {/* Room at the bottom for the phone tab bar. */}
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-28 sm:px-6 sm:pt-8 lg:pb-14 print:p-0">{children}</main>
    </div>
  )
}
