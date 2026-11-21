'use client'
import { useEffect, useState } from 'react'

/** Keep failed reads out of page data and let members retry in place. */
export function usePortalData<T>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    fetch(url, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Portal data unavailable')
        return response.json()
      })
      .then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [url, attempt])

  return { data, failed, retry: () => { setFailed(false); setAttempt(value => value + 1) } }
}
