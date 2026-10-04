'use client'

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Shield } from 'lucide-react'
import { Badge } from '@/components/ui'
import { APP_NAME } from '@/lib/brand'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/members': 'Members',
  '/contributions': 'Contributions',
  '/loans': 'Loans',
  '/agreements': 'Loan Agreements',
  '/loan-payments': 'Repayments',
  '/loan-history': 'Loan History',
  '/withdrawals': 'Withdrawals',
  '/payments': 'Online Payment Review',
  '/notifications': 'Notifications',
  '/ledger': 'Ledger',
  '/approvals': 'Approvals',
  '/settings/staff': 'Staff & Roles',
  '/settings/audit': 'Audit Log',
  '/security': 'My Security',
}

function titleFromPath(pathname: string) {
  const direct = pageTitles[pathname]
  if (direct) return direct
  const matched = Object.keys(pageTitles)
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
  return matched ? pageTitles[matched] : APP_NAME
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
          <div className="flex items-center gap-3 min-w-0">
            <img src="/mc-logo.png" alt={APP_NAME} className="hidden lg:block h-9 w-14 shrink-0 object-contain" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-slate-900">{pageTitle}</p>
              <div className="flex items-center gap-2">
                <p className="truncate text-xs text-slate-500">{APP_NAME} administration</p>
                {roleSummary && (
                  <Badge variant="blue">
                    <span className="inline-flex items-center gap-1">
                      <Shield size={11} />
                      {roleSummary}
                    </span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {canSearchMembers && <form onSubmit={handleSubmit} className="hidden md:block w-full max-w-md">
          <label className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors focus-within:border-indigo-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-100">
            <Search size={16} className="shrink-0 text-slate-400 group-focus-within:text-indigo-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quick search members by name or ID"
              className="w-full bg-transparent text-sm text-slate-700 outline-hidden placeholder:text-slate-400"
            />
          </label>
        </form>}
      </div>
    </header>
  )
}
