'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { APP_NAME } from '@/lib/brand'

export default function PortalNav({ user }: { user: { name?: string; memberId?: string } }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const nav = [
    { href: '/portal/dashboard',    label: 'My Dashboard' },
    { href: '/portal/pay',          label: 'Make a Payment' },
    { href: '/portal/history',      label: 'Payment History' },
    { href: '/portal/loan',         label: 'My Loan' },
    { href: '/portal/statements',   label: 'Statements' },
    { href: '/portal/agreements',   label: 'Loan Application' },
  ]

  return (
    <header className="bg-[#1B2A4A] shadow-xs relative z-40">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/brand/mc-logo-on-dark.svg" alt={APP_NAME} className="w-11 h-7 object-contain shrink-0" />
            <span className="text-white font-semibold text-sm truncate lg:hidden xl:inline">{APP_NAME}</span>
          </div>
          <nav className="hidden lg:flex items-center gap-1">
            {nav.map(item => (
              <Link key={item.href} href={item.href} className={cn(
                'px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap',
                path === item.href ? 'bg-white/15 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/8'
              )}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden lg:flex items-center gap-3 shrink-0">
          <span className="hidden xl:inline text-white/60 text-xs whitespace-nowrap">{user.memberId} · {user.name}</span>
          <button
            onClick={() => signOut({ callbackUrl: '/portal/login' })}
            className="text-white/60 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-white/8 transition-colors"
          >
            Sign out
          </button>
        </div>

        <button
          onClick={() => setOpen(v => !v)}
          className="lg:hidden p-2 -mr-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors shrink-0"
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-white/10 px-4 py-3 space-y-1">
          {nav.map(item => (
            <Link
              key={item.href} href={item.href} onClick={() => setOpen(false)}
              className={cn(
                'block px-3 py-2.5 rounded-lg text-sm transition-colors',
                path === item.href ? 'bg-white/15 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/8'
              )}
            >
              {item.label}
            </Link>
          ))}
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/10">
            <span className="text-white/60 text-xs whitespace-nowrap">{user.memberId} · {user.name}</span>
            <button
              onClick={() => signOut({ callbackUrl: '/portal/login' })}
              className="text-white/60 hover:text-white text-xs px-3 py-1.5 rounded-lg hover:bg-white/8 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
