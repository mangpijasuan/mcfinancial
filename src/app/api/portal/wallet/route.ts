import { prisma } from '@/lib/prisma'
import { requireMember } from '@/modules/auth'
import { appleWalletConfig, createMembershipPass } from '@/lib/appleWallet'

export const runtime = 'nodejs'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error

  const config = appleWalletConfig()
  if (!config) return new Response('Apple Wallet is not available.', { status: 503, headers })

  const member = await prisma.member.findUnique({
    where: { id: auth.principal.memberId },
    select: { id: true, legalName: true, joinDate: true, status: true },
  })
  if (member?.status !== 'Active') {
    return new Response('Apple Wallet passes are available to active members.', { status: 403, headers })
  }
  // A pass without a name would be useless: the club fixes the record first.
  if (!member.legalName.trim()) {
    return new Response('Your membership record has no name yet. Please contact MC Financial.', { status: 409, headers })
  }

  try {
    const pass = await createMembershipPass(config, member)
    return new Response(new Uint8Array(pass), {
      headers: {
        ...headers,
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="Millionaires-Club.pkpass"',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    // Logged for the officers (an expired certificate, an unreadable key…); the member sees a plain message.
    console.error('Apple Wallet pass could not be generated', { memberId: member.id, error: err instanceof Error ? err.message : String(err) })
    return new Response('The Apple Wallet pass could not be generated. Please contact MC Financial.', { status: 503, headers })
  }
}
