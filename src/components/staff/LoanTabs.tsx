import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/loans', label: 'Current loans' },
  { href: '/loan-history', label: '2021–2025 records' },
] as const

/** The two views under Loans in the menu: today's loans and the older records. */
export default function LoanTabs({ current }: { current: (typeof TABS)[number]['href'] }) {
  return (
    <nav aria-label="Loans" className="mb-5 flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? 'page' : undefined}
          className={cn(
            '-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm',
            tab.href === current ? 'border-[#1B2A4A] font-semibold text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
