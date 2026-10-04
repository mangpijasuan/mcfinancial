/**
 * A member record without login secrets. The portal fields on Member are
 * frozen since M8 (the login is a member User), so they are left out too:
 * routes that show portal access read it from the login.
 */
export function sanitizeMember<T extends Record<string, any>>(member: T) {
  const { portalPassword, portalEnabled, portalSessionsValidAfter, ...safe } = member
  return safe
}

