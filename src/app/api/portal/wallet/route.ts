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
  } catch {
    return new Response('The Apple Wallet pass could not be generated. Please contact MC Financial.', { status: 503, headers })
  }
}
