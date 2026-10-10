// A stand-in for Intuit's OAuth and QuickBooks Online Accounting API, just
// enough for the ACH flow: tokens, items, customers, invoices, payments.
export const QBO_TEST_ENV = {
  QBO_CLIENT_ID: 'client-test',
  QBO_CLIENT_SECRET: 'secret-test',
  QBO_REDIRECT_URI: 'https://admin.example.test/api/quickbooks/callback',
  QBO_TOKEN_URL: 'https://qbo.test/token',
  QBO_REVOKE_URL: 'https://qbo.test/revoke',
  QBO_API_BASE: 'https://qbo.test/api',
}

type Invoice = { Id: string; TotalAmt: number; Balance: number; InvoiceLink?: string; LinkedTxn?: { TxnId: string; TxnType: string }[]; CustomerRef: string; BillEmail?: string; ItemRef?: string; deleted?: boolean }

export function fakeQuickBooks() {
  let next = 1
  const state = {
    tokenStatus: 200,
    tokenError: undefined as string | undefined,
    omitRefreshExpiry: false,
    grants: [] as string[],
    revoked: [] as string[],
    revokeFails: false,
    /** Access tokens QuickBooks no longer accepts (expired early). */
    refused: new Set<string>(),
    items: [
      { Id: '1', Name: 'Monthly dues', Type: 'Service' },
      { Id: '2', Name: 'Loan repayment', Type: 'NonInventory' },
      { Id: '3', Name: 'Club T-shirt', Type: 'Inventory' },
    ],
    customers: [] as { Id: string; DisplayName: string; email?: string }[],
    invoices: new Map<string, Invoice>(),
    payments: new Map<string, { TxnDate?: string }>(),
    /** One-shot failures: the next matching call answers with this instead. */
    failures: [] as { match: RegExp; status: number; body?: unknown }[],
    invoiceLink: (id: string): string | undefined => `https://connect.intuit.example/pay/${id}`,
    /** Runs before an invoice is read: lets a test change things mid-check. */
    beforeInvoiceRead: undefined as undefined | ((id: string) => Promise<void>),
    calls: [] as string[],
  }

  const json = (body: unknown, status = 200) => new Response(body === undefined ? 'not json' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fault = (status: number, code: string, Message: string, Detail?: string) => json({ Fault: { Error: [{ Message, Detail, code }] } }, status)

  function issue() {
    const n = next++
    return {
      access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 3600,
      ...(state.omitRefreshExpiry ? {} : { x_refresh_token_expires_in: 8_726_400 }),
    }
  }

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    state.calls.push(`${method} ${url.pathname}`)
    const failure = state.failures.findIndex((f) => f.match.test(`${method} ${url.pathname}`))
    if (failure >= 0) {
      const [f] = state.failures.splice(failure, 1)
      return json(f.body, f.status)
    }

    if (url.href === QBO_TEST_ENV.QBO_TOKEN_URL) {
      const form = new URLSearchParams(String(init?.body))
      state.grants.push(form.get('grant_type') ?? '')
      if (state.tokenStatus !== 200) return json(state.tokenError ? { error: state.tokenError } : undefined, state.tokenStatus)
      return json(issue())
    }
    if (url.href === QBO_TEST_ENV.QBO_REVOKE_URL) {
      if (state.revokeFails) throw new Error('network down')
      state.revoked.push(JSON.parse(String(init?.body)).token)
      return json({})
    }

    const m = url.pathname.match(/^\/api\/v3\/company\/(\d+)\/(.+)$/)
    if (!m) return json({}, 404)
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? '').replace('Bearer ', '')
    if (state.refused.has(token)) return json({ fault: 'expired' }, 401)
    const path = m[2]
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    if (path === 'query') {
      const q = url.searchParams.get('query') ?? ''
      if (/from Item/.test(q)) return json({ QueryResponse: { Item: state.items, maxResults: state.items.length } })
      const name = q.match(/DisplayName = '((?:\\.|[^'])*)'/)?.[1]?.replace(/\\(.)/g, '$1')
      const found = state.customers.filter((c) => c.DisplayName === name)
      return json({ QueryResponse: found.length ? { Customer: found } : {} })
    }
    if (path === 'customer' && method === 'POST') {
      if (state.customers.some((c) => c.DisplayName === body.DisplayName)) return fault(400, '6240', 'Duplicate Name Exists Error', 'The name supplied already exists.')
      const c = { Id: `C${next++}`, DisplayName: body.DisplayName, email: body.PrimaryEmailAddr?.Address }
      state.customers.push(c)
      return json({ Customer: c })
    }
    if (path === 'invoice' && method === 'POST') {
      const id = `${next++}`
      const amount = body.Line[0].Amount
      state.invoices.set(id, { Id: id, TotalAmt: amount, Balance: amount, CustomerRef: body.CustomerRef.value, BillEmail: body.BillEmail?.Address, ItemRef: body.Line[0].SalesItemLineDetail.ItemRef.value })
      return json({ Invoice: { Id: id, TotalAmt: amount, Balance: amount } })
    }
    const inv = path.match(/^invoice\/(\w+)$/)
    if (inv) {
      await state.beforeInvoiceRead?.(inv[1])
      const invoice = state.invoices.get(inv[1])
      if (!invoice || invoice.deleted) return fault(400, '610', 'Object Not Found', 'Something you are trying to use has been made inactive.')
      const link = url.searchParams.get('include') === 'invoiceLink' ? state.invoiceLink(invoice.Id) : undefined
      return json({ Invoice: { ...invoice, InvoiceLink: link } })
    }
    const pay = path.match(/^payment\/(\w+)$/)
    if (pay) return json({ Payment: state.payments.get(pay[1]) ?? {} })
    return json({}, 404)
  }) as typeof fetch

  /** The member pays the invoice in full on QuickBooks' page. */
  function pay(invoiceId: string, txnDate?: string) {
    const invoice = state.invoices.get(invoiceId)!
    const paymentId = `P${next++}`
    state.payments.set(paymentId, { TxnDate: txnDate })
    invoice.Balance = 0
    invoice.LinkedTxn = [{ TxnId: paymentId, TxnType: 'Payment' }]
    return paymentId
  }

  return { state, fetch: fetchFn, pay }
}
