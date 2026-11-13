'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Shield } from 'lucide-react'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/members': 'Members',
  '/contributions': 'Contributions',
  '/loans': 'Loans',
  '/agreements': 'Loan Agreements',
  '/loan-payments': 'Repayments',
  '/loan-history': 'Loans',
  '/withdrawals': 'Withdrawals',
  '/dues': 'Dues',
  '/treasury': 'Treasury',
  '/reconciliation': 'Reconciliation',
  '/reports': 'Reports',
  '/payments': 'Online Payment Review',
  '/notifications': 'Notifications',
  '/ledger': 'Ledger',
  '/approvals': 'Approvals',
  '/settings/staff': 'Staff & Roles',
  '/settings/audit': 'Audit Log',
  '/settings/data': 'Data Export',
  '/bulk-upload': 'Bulk Upload',
  '/members/import': 'Import members',
  '/contributions/import': 'Import contributions',
  '/security': 'My Security',
}

function titleFromPath(pathname: string) {
  const direct = pageTitles[pathname]
  if (direct) return direct
  const matched = Object.keys(pageTitles)
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
  // A page without an entry is named from its path, never the club's name again.
  if (matched) return pageTitles[matched]
  const first = pathname.split('/').filter(Boolean)[0] ?? ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, ' ') : 'Dashboard'
}

export default function AdminTopbar({ roleSummary, canSearchMembers }: { roleSummary?: string; canSearchMembers: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState('')

  const pageTitle = useMemo(() => titleFromPath(pathname), [pathname])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) {
      router.push('/members')
      return
    }
    router.push(`/members?q=${encodeURIComponent(q)}`)
  }

  return (
    <header className="sticky top-14 z-30 border-b-2 border-gold bg-workspace-chrome text-white lg:top-0">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 lg:px-6">
        <div className="min-w-0">
          {/* The sidebar shows the logo, the club's name and your role. On a phone,
              where it is folded away, and on desktop while it is collapsed
              (globals.css, .role-in-topbar), the role shows here instead. A long
              list of roles is shortened so the page title keeps its room. */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="shrink-0 whitespace-nowrap text-base font-semibold text-white">{pageTitle}</p>
            {roleSummary && (
              <span
                className="role-in-topbar min-w-0 max-w-full items-center gap-1 rounded-md bg-workspace-tab px-2 py-0.5 text-xs font-semibold text-white"
                title={roleSummary}
              >
                <Shield size={11} className="shrink-0" />
                <span className="truncate">{roleSummary}</span>
              </span>
            )}
          </div>
        </div>

        {canSearchMembers && <form onSubmit={handleSubmit} className="hidden md:block w-full max-w-md">
          <label className="group flex items-center gap-3 rounded-md border border-white/25 bg-workspace-tab px-3 py-1.5 transition-colors focus-within:border-gold focus-within:ring-1 focus-within:ring-gold">
            <Search size={16} className="shrink-0 text-slate-200 group-focus-within:text-gold" />
            <input
              type="search"
              aria-label="Quick search members by name or ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick search members by name or ID"
              className="h-6 w-full bg-transparent text-sm text-white outline-hidden placeholder:text-slate-200"
            />
          </label>
        </form>}
      </div>
    </header>
  )
}
