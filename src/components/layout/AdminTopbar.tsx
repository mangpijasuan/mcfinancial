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
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm supports-backdrop-filter:bg-white/75">
      <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-8">
        <div className="min-w-0">
          {/* The sidebar shows the logo, the club's name and your role. On a phone,
              where it is folded away, and on desktop while it is collapsed
              (globals.css, .role-in-topbar), the role shows here instead. A long
              list of roles is shortened so the page title keeps its room. */}
          <div className="flex items-center gap-2 min-w-0">
            <p className="shrink-0 whitespace-nowrap text-base font-semibold text-slate-900">{pageTitle}</p>
            {roleSummary && (
              <span
                className="role-in-topbar min-w-0 max-w-full items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
                title={roleSummary}
              >
                <Shield size={11} className="shrink-0" />
                <span className="truncate">{roleSummary}</span>
              </span>
            )}
          </div>
        </div>

        {canSearchMembers && <form onSubmit={handleSubmit} className="hidden md:block w-full max-w-md">
          <label className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
            <Search size={16} className="shrink-0 text-slate-400 group-focus-within:text-indigo-500" />
            <input
              type="search"
              aria-label="Quick search members by name or ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick search members by name or ID"
              className="h-6 w-full bg-transparent text-sm text-slate-700 outline-hidden placeholder:text-slate-500"
            />
          </label>
        </form>}
      </div>
    </header>
  )
}
