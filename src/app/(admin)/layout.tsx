import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import AdminTopbar from '@/components/layout/AdminTopbar'
import { StaffProvider } from '@/components/staff/StaffContext'
import { getPrincipal } from '@/modules/auth'
import { roleLabel } from '@/modules/permissions'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Resolves the session against the database (revocation, timeouts,
  // current roles). Pages and APIs check their own permissions as well —
  // a layout does not re-run on every navigation.
  const principal = await getPrincipal()
  if (!principal) redirect('/login')
  if (principal.kind === 'member') redirect('/portal/dashboard')
  if (!principal.mfaVerified) redirect('/security/mfa')

  const permissions = [...principal.permissions].sort()
  const roleSummary = principal.roles.map(roleLabel).join(', ') || 'No roles assigned'
  const staff = { name: principal.name, email: principal.email, roleLabels: principal.roles.map(roleLabel), permissions }

  return (
    <StaffProvider value={staff}>
      <div className="flex min-h-screen">
        {/* Pages that print (statements) print without the navigation. */}
        <div className="contents print:hidden"><Sidebar permissions={permissions} roleSummary={roleSummary} /></div>
        <main className="flex-1 overflow-auto pt-14 lg:pt-0 print:pt-0">
          <div className="contents print:hidden"><AdminTopbar roleSummary={roleSummary} canSearchMembers={permissions.includes('members.read')} /></div>
          {children}
        </main>
      </div>
    </StaffProvider>
  )
}
