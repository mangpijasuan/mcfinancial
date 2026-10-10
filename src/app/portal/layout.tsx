import type { Metadata } from 'next'
import '@fontsource-variable/inter'

// Members see the portal's own name in the browser tab (the rest of the
// app is titled "Millionaires Club — Admin").
export const metadata: Metadata = {
  title: 'Millionaires Club — Member Portal',
}

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="font-portal antialiased">{children}</div>
}
