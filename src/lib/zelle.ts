import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// The club's Zelle details, shown to members on the portal's payment page.
// Read on the server at request time: a NEXT_PUBLIC_ variable is frozen into
// the build, and the Docker image is built without .env.production, so it
// would never show (found in the Stage 1 rehearsal).
export function zelleRecipient(): { name: string; email: string } | null {
  const name = process.env.ZELLE_RECIPIENT_NAME?.trim() || ''
  const email = process.env.ZELLE_RECIPIENT_EMAIL?.trim() || ''
  return name || email ? { name, email } : null
}

/** Larger than any QR code image needs to be. */
export const ZELLE_QR_MAX_BYTES = 2 * 1024 * 1024

/**
 * The club's Zelle QR code, as saved from the club's bank app. It lives
 * on the server, outside the code (`club/zelle-qr.png`, mounted read-only
 * into the app; or ZELLE_QR_FILE), so changing it needs no new release.
 */
export function zelleQrPath(): string {
  return process.env.ZELLE_QR_FILE?.trim() || path.join(process.cwd(), 'club', 'zelle-qr.png')
}

const SIGNATURES: { type: string; bytes: number[]; at?: number }[] = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], at: 8 }, // "WEBP" after the RIFF header
]

/**
 * The QR code image and its type, or null when there is none, or the file
 * is not a PNG, JPEG or WebP image of a sensible size. The type comes from
 * the file's first bytes, never from its name.
 */
export function readZelleQr(file = zelleQrPath()): { bytes: Buffer; type: string } | null {
  try {
    const stat = statSync(file)
    if (!stat.isFile() || stat.size === 0 || stat.size > ZELLE_QR_MAX_BYTES) return null
    const bytes = readFileSync(file)
    const match = SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[(s.at ?? 0) + i] === b))
    return match ? { bytes, type: match.type } : null
  } catch {
    return null
  }
}
