'use client'
import { useEffect, useState } from 'react'
import { Mail, AlertTriangle, BarChart2 } from 'lucide-react'
import { Card, Button, PageHeader, Badge } from '@/components/ui'
import { fmtDate } from '@/lib/utils'
import { useStaff } from '@/components/staff/StaffContext'

function ActionCard({ icon, title, description, detail, buttonLabel, buttonVariant = 'primary', onClick, loading, result, warning }: any) {
  return (
    <Card className="p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-1 items-start gap-4 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#1B2A4A]/10 flex items-center justify-center shrink-0 text-[#1B2A4A]">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
            {detail && <p className="text-sm font-semibold text-indigo-700 mt-2">{detail}</p>}
            {warning && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">{warning}</p>}
            {result && (
              <div className={`text-sm font-medium mt-3 px-3 py-2 rounded-lg ${result.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                {result.error ? `⚠ ${result.error}` : `✓ Sent ${result.sent} · Failed ${result.failed}`}
              </div>
            )}
          </div>
        </div>
        <Button onClick={onClick} disabled={loading} size="sm" variant={buttonVariant} className="w-full sm:w-auto sm:shrink-0">
          {loading ? 'Sending…' : buttonLabel}
        </Button>
      </div>
    </Card>
  )
}

export default function NotificationsPage() {
  const { can } = useStaff()
  const [stats, setStats]           = useState<any>(null)
  const [loadingType, setLoadingType] = useState('')
  const [results, setResults]       = useState<Record<string, any>>({})
  const [error, setError]           = useState('')

  async function readJsonSafe(res: Response) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        setError('')
        const res = await fetch('/api/notifications')
        const data = await readJsonSafe(res)
        if (!res.ok || !data) throw new Error('Failed to load notifications data.')
        setStats(data)
      } catch (err: any) {
        setError(err?.message || 'Failed to load notifications data.')
      }
    })()
  }, [])

  async function send(type: string) {
    setLoadingType(type)
    const res = await fetch('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    })
    const data = await readJsonSafe(res)
    setResults(r => ({ ...r, [type]: data }))
    setLoadingType('')
    // Refresh logs
    const refreshRes = await fetch('/api/notifications')
    const refreshData = await readJsonSafe(refreshRes)
    if (refreshRes.ok && refreshData) setStats(refreshData)
  }

  const noEmailWarning = 'Members without an email address will not receive this notification. Add emails from the Members page.'
  const setupWarning = 'Requires RESEND_API_KEY in your .env file. See setup instructions below.'

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Notifications" sub="Send emails to members and admins" />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Setup banner */}
      <Card className="p-5 mb-6 bg-indigo-50 border-indigo-200">
        <div className="flex items-start gap-3">
          <Mail size={18} className="text-indigo-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-indigo-900">Email setup required</p>
            <p className="text-sm text-indigo-700 mt-1">
              Add these two lines to your <code className="bg-indigo-100 px-1.5 py-0.5 rounded-sm text-xs">.env</code> file, then restart the app:
            </p>
            <pre className="mt-2 bg-white border border-indigo-200 rounded-lg px-4 py-3 text-xs font-mono text-gray-800 overflow-x-auto">
{`RESEND_API_KEY="re_xxxxxxxxxxxx"   # Get free at resend.com
ADMIN_EMAIL="your@email.com"       # Where to send admin summaries`}
            </pre>
            <p className="text-xs text-indigo-600 mt-2">
              Free tier: 3,000 emails/month · No credit card needed · Sign up at{' '}
              <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="underline font-semibold">resend.com</a>
            </p>
          </div>
        </div>
      </Card>

      {/* Action cards */}
      {can('notifications.send') && <div className="space-y-4 mb-8">
        <ActionCard
          icon={<Mail size={18} />}
          title="Monthly contribution reminders"
          description="Send a reminder to all active members who haven't paid this month."
          detail={stats ? `${stats.unpaidMembers?.length ?? 0} members would receive this email` : 'Loading…'}
          buttonLabel="Send reminders"
          onClick={() => send('contribution_reminders')}
          loading={loadingType === 'contribution_reminders'}
          result={results['contribution_reminders']}
          warning={noEmailWarning}
        />
        <ActionCard
          icon={<AlertTriangle size={18} />}
          title="Loan overdue alerts"
          description="Notify borrowers whose loan payments are overdue."
          detail={stats ? `${stats.overdueLoans?.length ?? 0} borrowers would receive this` : 'Loading…'}
          buttonLabel="Send overdue alerts"
          buttonVariant="danger"
          onClick={() => send('loan_overdue')}
          loading={loadingType === 'loan_overdue'}
          result={results['loan_overdue']}
          warning={noEmailWarning}
        />
        <ActionCard
          icon={<BarChart2 size={18} />}
          title="Admin monthly summary"
          description="Send a summary report to the admin email with key stats."
          detail={process.env.NEXT_PUBLIC_ADMIN_EMAIL ? `Will send to ${process.env.NEXT_PUBLIC_ADMIN_EMAIL}` : 'Set ADMIN_EMAIL in .env to enable'}
          buttonLabel="Send summary"
          buttonVariant="secondary"
          onClick={() => send('admin_summary')}
          loading={loadingType === 'admin_summary'}
          result={results['admin_summary']}
          warning={setupWarning}
        />
      </div>}

      {/* Email log */}
      <Card>
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Recent email log</h2>
        </div>
        {!stats?.recentLogs?.length ? (
          <p className="py-10 text-center text-sm text-gray-400">No emails sent yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {stats.recentLogs.map((log: any) => (
              <div key={log.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{log.subject}</p>
                  <p className="text-xs text-gray-400">{log.recipient} · {fmtDate(log.sentAt)}</p>
                </div>
                <Badge variant={log.status === 'sent' ? 'green' : 'red'}>
                  {log.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
