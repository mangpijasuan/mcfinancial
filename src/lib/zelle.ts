// The club's Zelle details, shown to members on the portal's payment page.
// Read on the server at request time: a NEXT_PUBLIC_ variable is frozen into
// the build, and the Docker image is built without .env.production, so it
// would never show (found in the Stage 1 rehearsal).
export function zelleRecipient(): { name: string; email: string } | null {
  const name = process.env.ZELLE_RECIPIENT_NAME?.trim() || ''
  const email = process.env.ZELLE_RECIPIENT_EMAIL?.trim() || ''
  return name || email ? { name, email } : null
}
