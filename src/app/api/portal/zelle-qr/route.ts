import { requireMember } from '@/modules/auth'
import { readZelleQr } from '@/lib/zelle'

// The club's Zelle QR code, for signed-in members only: members scan it in
// their own bank's app to send a payment to the club.
export async function GET() {
  const auth = await requireMember()
  if (auth.error) return auth.error

  const qr = readZelleQr()
  if (!qr) return new Response('No Zelle QR code has been added.', { status: 404 })
  return new Response(new Uint8Array(qr.bytes), {
    headers: {
      'Content-Type': qr.type,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
