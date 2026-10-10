// A stand-in for Intuit's sign-in and the QuickBooks Online API, for the
// browser tests only (e2e/08-quickbooks-ach.spec.ts). It approves every
// sign-in, keeps everything in memory, and serves a "pay this invoice"
// page in place of QuickBooks' own. Never used outside the tests.
import http from 'node:http'

const PORT = Number(process.env.FAKE_QBO_PORT || 3399)
const REALM = '9130350000000001'
let next = 1
const items = [
  { Id: '1', Name: 'Monthly dues', Type: 'Service' },
  { Id: '2', Name: 'Loan repayment', Type: 'Service' },
]
const customers = []
const invoices = new Map()
const payments = new Map()

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type })
  res.end(type === 'application/json' ? JSON.stringify(body) : body)
}
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => resolve(b)) })
const today = () => new Date().toISOString().slice(0, 10)

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const body = await readBody(req)

  if (url.pathname === '/health') return send(res, 200, { ok: true })

  // Intuit's sign-in: the Treasurer approves, and is sent back with a code.
  if (url.pathname === '/connect') {
    const back = new URL(url.searchParams.get('redirect_uri'))
    back.searchParams.set('code', `code-${next++}`)
    back.searchParams.set('state', url.searchParams.get('state'))
    back.searchParams.set('realmId', REALM)
    res.writeHead(302, { location: back.toString() })
    return res.end()
  }
  if (url.pathname === '/token') {
    const n = next++
    return send(res, 200, { access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 3600, x_refresh_token_expires_in: 8726400 })
  }
  if (url.pathname === '/revoke') return send(res, 200, {})

  // QuickBooks' payment page for an invoice.
  const page = url.pathname.match(/^\/pay\/(\w+)$/)
  if (page) {
    const invoice = invoices.get(page[1])
    if (!invoice) return send(res, 404, 'No such invoice', 'text/html')
    if (req.method === 'POST') {
      const paymentId = `P${next++}`
      payments.set(paymentId, { TxnDate: today() })
      invoice.Balance = 0
      invoice.LinkedTxn = [{ TxnId: paymentId, TxnType: 'Payment' }]
    }
    const paid = invoice.Balance === 0
    return send(res, 200, `<!doctype html><html lang="en"><head><title>Invoice ${invoice.Id}</title></head><body>
      <main><h1>Invoice ${invoice.Id}: $${invoice.TotalAmt.toFixed(2)}</h1>
      ${paid ? '<p>Payment sent. Thank you!</p>' : `<form method="post"><button type="submit">Pay $${invoice.TotalAmt.toFixed(2)} from my bank account</button></form>`}
      </main></body></html>`, 'text/html')
  }

  const api = url.pathname.match(/^\/v3\/company\/(\d+)\/(.+)$/)
  if (!api) return send(res, 404, {})
  const path = api[2]
  const json = body ? JSON.parse(body) : undefined

  if (path === 'query') {
    const q = url.searchParams.get('query') || ''
    if (/from Item/.test(q)) return send(res, 200, { QueryResponse: { Item: items } })
    const name = (q.match(/DisplayName = '((?:\\.|[^'])*)'/) || [])[1]?.replace(/\\(.)/g, '$1')
    const found = customers.filter((c) => c.DisplayName === name)
    return send(res, 200, { QueryResponse: found.length ? { Customer: found } : {} })
  }
  if (path === 'customer') {
    if (customers.some((c) => c.DisplayName === json.DisplayName)) {
      return send(res, 400, { Fault: { Error: [{ Message: 'Duplicate Name Exists Error', code: '6240' }] } })
    }
    const c = { Id: `C${next++}`, DisplayName: json.DisplayName }
    customers.push(c)
    return send(res, 200, { Customer: c })
  }
  if (path === 'invoice') {
    const id = String(next++)
    const amount = json.Line[0].Amount
    invoices.set(id, { Id: id, TotalAmt: amount, Balance: amount })
    return send(res, 200, { Invoice: invoices.get(id) })
  }
  const inv = path.match(/^invoice\/(\w+)$/)
  if (inv) {
    const invoice = invoices.get(inv[1])
    if (!invoice) return send(res, 400, { Fault: { Error: [{ Message: 'Object Not Found', code: '610' }] } })
    const link = url.searchParams.get('include') === 'invoiceLink' ? `http://localhost:${PORT}/pay/${invoice.Id}` : undefined
    return send(res, 200, { Invoice: { ...invoice, InvoiceLink: link } })
  }
  const pay = path.match(/^payment\/(\w+)$/)
  if (pay) return send(res, 200, { Payment: payments.get(pay[1]) || {} })
  return send(res, 404, {})
}).listen(PORT, () => console.log(`fake QuickBooks on ${PORT}`))
