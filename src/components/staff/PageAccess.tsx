'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldOff } from 'lucide-react'
import { landingPath, pagePermission } from './nav'
import { useStaff } from './StaffContext'

/**
 * A page this person's roles do not open says so, instead of loading and
 * failing on its data. Showing only: every API checks the permission itself.
 */
export default function PageAccess({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const { staff, can } = useStaff()
  const needed = pagePermission(path)
  if (!needed || can(needed)) return <>{children}</>
  return (
    <div className="p-4 sm:p-8">
      <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-6 text-center shadow-xs">
        <ShieldOff className="mx-auto text-gray-400" size={28} aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-gray-900">You don’t have access to this page</h1>
        <p className="mt-1 text-sm text-gray-600">Your roles do not include it. If you need it for your work, ask a staff administrator under Staff &amp; Roles.</p>
        <Link href={landingPath(staff?.permissions ?? [])} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-[#1B2A4A] px-4 text-sm font-medium text-white hover:bg-[#243660]">
          Go to your start page
        </Link>
      </div>
    </div>
  )
}
