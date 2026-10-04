import { redirect } from 'next/navigation'

// /portal on its own is the member's home: the dashboard (which sends a
// signed-out member to the login page).
export default function PortalHome() {
  redirect('/portal/dashboard')
}
