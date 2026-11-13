'use client'
import { useEffect, useState } from 'react'
import { Contact, Wallet } from 'lucide-react'
import MembershipCardDownload, { MembershipCardPreview } from '@/components/portal/MembershipCardDownload'
import { Empty, PageHeader, PageSkeleton, button, surface } from '@/components/portal/kit'
import { cn } from '@/lib/utils'

// The member's card, from the account menu: a preview drawn exactly as it
// downloads, the PNG download, and Apple Wallet once the club has set it up.
export default function PortalCard() {
  const [member, setMember] = useState<any>(null)

  useEffect(() => {
    fetch('/api/portal/me').then(r => r.json()).then(setMember)
  }, [])

  if (!member) return <PageSkeleton />

  const name = member.legalName?.trim()
  // Join dates are stored as midnight UTC: read the year in UTC.
  const joinYear = new Date(member.joinDate).getUTCFullYear()
  const hasCard = member.status === 'Active' && !!name && Number.isFinite(joinYear)

  return (
    <div className="space-y-5">
      <PageHeader title="Membership card" sub="Your Millionaires Club card, to save on your phone or print." />
      <section className={cn(surface, 'p-4 sm:p-8')}>
        {hasCard ? (
          <div className="mx-auto max-w-xl space-y-5">
            <MembershipCardPreview fullName={name} memberId={member.id} joinYear={joinYear} />
            <div className="flex flex-wrap justify-center gap-2">
              <MembershipCardDownload fullName={name} memberId={member.id} joinYear={joinYear} tone="light" />
              {member.appleWalletAvailable && (
                <a href="/api/portal/wallet" className={button.secondary}><Wallet size={16} aria-hidden /> Add to Apple Wallet</a>
              )}
            </div>
            <p className="text-center text-xs text-gray-500">The download is a picture of your card (PNG). Keep it in your photos, or print it.</p>
          </div>
        ) : (
          <Empty icon={Contact} title="No membership card yet">
            Cards are for active members. If you think you should have one, please contact a club officer.
          </Empty>
        )}
      </section>
    </div>
  )
}
