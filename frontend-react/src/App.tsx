import React, { useState, useRef, useEffect } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

type TransactionRequest = {
  amount: number
  currency?: string
  merchant: string
}

type TransactionResponse = {
  amount: number
  currency: string
  merchant: string
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH'
}

export default function App() {
  const [amount, setAmount] = useState<number | ''>('')
  const [user, setUser] = useState<{ name: string; email: string } | null>(() => {
    try {
      const raw = localStorage.getItem('fg_user')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [googleClientId, setGoogleClientId] = useState<string | null>(() => {
    try { return localStorage.getItem('fg_google_cid') } catch { return null }
  })
  const [idToken, setIdToken] = useState<string | null>(() => {
    try { return localStorage.getItem('fg_id_token') } catch { return null }
  })
  const googleButtonRef = useRef<HTMLDivElement | null>(null)
  const [gsiRendered, setGsiRendered] = useState(false)
  const [merchant, setMerchant] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TransactionResponse | null>(null)
  const [riskColor, setRiskColor] = useState('bg-gray-100')
  const [riskLevel, setRiskLevel] = useState<string | null>(null)
  const [recentChecks, setRecentChecks] = useState<TransactionResponse[]>([])
  const copyRef = useRef<HTMLButtonElement | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [gsiError, setGsiError] = useState<string | null>(null)
  const [prevChecks, setPrevChecks] = useState<TransactionResponse[] | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const [prevDeleted, setPrevDeleted] = useState<{ item: TransactionResponse; index: number } | null>(null)
  const singleUndoTimerRef = useRef<number | null>(null)

  // Demo user used for local testing when no Google sign-in is present
  const DEMO_USER = { name: 'Demo User', email: 'demo@local' }

  useEffect(() => {
    // Load recent transactions from backend (if available). Re-run when `user` changes so
    // signed-in users see their own dashboard.
    async function load() {
      try {
        // If the user has a local copy of recent checks (e.g. after deletes), prefer that so
        // client-side removals persist across page reloads. Otherwise fall back to backend.
        const raw = localStorage.getItem('recentChecks')
        if (raw) {
          try {
            setRecentChecks(JSON.parse(raw))
            return
          } catch {}
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (idToken) headers['Authorization'] = `Bearer ${idToken}`
        else if (user) headers['X-User'] = JSON.stringify({ name: user.name, email: user.email })
        else headers['X-User'] = JSON.stringify(DEMO_USER)
        const res = await fetch('http://localhost:8000/transactions', { headers })
        if (res.ok) {
          const json = await res.json()
          const items = json.items || []
          setRecentChecks(items)
          try { localStorage.setItem('recentChecks', JSON.stringify(items)) } catch {}
        }
      } catch {}
    }
    load()
  }, [user, idToken])

  // Fetch OAuth client config from backend so frontend auto-configures in dev
  useEffect(() => {
    async function cfg() {
      try {
        const res = await fetch('http://localhost:8000/auth/config')
        if (!res.ok) return
        const json = await res.json()
        const cid = json.client_id
        if (cid && !googleClientId) {
          setGoogleClientId(cid)
          try { localStorage.setItem('fg_google_cid', cid) } catch {}
        }
      } catch (e) {
        // ignore
      }
    }
    cfg()
  }, [])

  // SECURITY: ensure any previously-entered dev Google client ID is removed
  // so a secret client ID isn't left in localStorage after testing.
  useEffect(() => {
    try {
      localStorage.removeItem('fg_google_cid')
      setGoogleClientId(null)
    } catch {}
  }, [])

  const valid = amount !== '' && Number(amount) > 0 && merchant.trim().length >= 2

  const formatCurrency = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

  // Fallback risk computation used for local/demo testing when backend doesn't provide a risk.
  // Numeric thresholds only; merchant-specific overrides are applied separately.
  function computeRisk(amount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (amount >= 500) return 'HIGH'
    if (amount >= 100) return 'MEDIUM'
    return 'LOW'
  }

  // Merchant-based override map. Return an explicit risk for certain merchants
  // (e.g. Apple Store should be treated as LOW in demo scenarios).
  function getMerchantOverride(merchant?: string): 'LOW' | 'MEDIUM' | 'HIGH' | undefined {
    const m = (merchant || '').toLowerCase().trim()
    // normalize: remove punctuation so variants like "Apple, Inc." or "Apple.Store" match
    const norm = m.replace(/[^a-z0-9\s]/g, ' ')
    // Treat Apple-related merchants as LOW for demo purposes (word-boundary match)
    if (/\bapple\b/.test(norm)) return 'LOW'
    // Treat Target as MEDIUM
    if (/\btarget\b/.test(norm)) return 'MEDIUM'
    return undefined
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    if (!valid) {
      setError('Please enter a valid amount and merchant name (min 2 chars).')
      return
    }

    const payload: TransactionRequest = { amount: Number(amount), currency: 'USD', merchant: merchant.trim() }
    setLoading(true)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`
      } else if (user) {
        headers['X-User'] = JSON.stringify({ name: user.name, email: user.email })
      } else {
        // allow local testing without Google sign-in by sending a demo X-User header
        headers['X-User'] = JSON.stringify(DEMO_USER)
      }
      const res = await fetch('http://localhost:8000/transactions', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `Request failed (${res.status})`)
      }
      const data = (await res.json()) as TransactionResponse
      // Compute a local fallback risk and merge with backend result.
      // Rules precedence:
      // 1) Global AML threshold (>= $10,000) => HIGH
      // 2) Merchant-specific overrides (e.g. Apple => LOW, Target => MEDIUM)
      // 3) Prefer the higher-severity between backend and computed fallback
      const fallback = computeRisk(payload.amount)
      const backendRisk = data.risk_level as 'LOW' | 'MEDIUM' | 'HIGH' | undefined
      const override = getMerchantOverride(payload.merchant)
      const severity: Record<'LOW' | 'MEDIUM' | 'HIGH', number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }
      let lvl: 'LOW' | 'MEDIUM' | 'HIGH'
      if (payload.amount >= 10000) {
        // AML: amounts at or above $10k are always HIGH risk
        lvl = 'HIGH'
      } else if (override) {
        lvl = override
      } else if (backendRisk) {
        lvl = severity[backendRisk] >= severity[fallback] ? backendRisk : fallback
      } else {
        lvl = fallback
      }
      setResult({ ...data, risk_level: lvl })
      setRiskLevel(lvl)
      if (lvl === 'HIGH') {
        setRiskColor('bg-red-500 text-white')
      } else if (lvl === 'MEDIUM') {
        setRiskColor('bg-yellow-400 text-black')
      } else {
        setRiskColor('bg-green-500 text-white')
      }
        // push to recent checks (most recent first) and ensure each item has a risk_level
        const next = [{ ...data, risk_level: lvl }, ...recentChecks].slice(0, 8)
        setRecentChecks(next)
        try { localStorage.setItem('recentChecks', JSON.stringify(next)) } catch {}
        setToast('Saved to recent checks')
    } catch (err: any) {
      setError(String(err?.message ?? err ?? 'Request failed'))
    } finally {
      setLoading(false)
    }
  }
  async function copyResult() {
    if (!result) return
    const text = JSON.stringify(result, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      if (copyRef.current) {
        copyRef.current.textContent = 'Copied'
        setTimeout(() => (copyRef.current!.textContent = 'Copy JSON'), 1000)
      }
      setToast('Result JSON copied')
      setTimeout(() => setToast(null), 1200)
    } catch {}
  }
  function clearRecentChecks() {
    // keep a copy so user can undo
    setPrevChecks(recentChecks)
    setRecentChecks([])
    try {
      localStorage.removeItem('recentChecks')
    } catch {}
    setToast('Cleared recent checks')
    // allow undo for 8s
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
    }
    undoTimerRef.current = window.setTimeout(() => {
      setPrevChecks(null)
      undoTimerRef.current = null
    }, 8000)
    setTimeout(() => setToast(null), 3000)
  }

  function undoClear() {
    if (!prevChecks) return
    // restore
    setRecentChecks(prevChecks)
    try { localStorage.setItem('recentChecks', JSON.stringify(prevChecks)) } catch {}
    setPrevChecks(null)
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setToast('Restored recent checks')
    setTimeout(() => setToast(null), 1200)
  }

  // Remove a single recent check by index
  function removeRecentCheck(index: number) {
    setRecentChecks((prev) => {
      const next = [...prev]
      if (index >= 0 && index < next.length) {
        const [removed] = next.splice(index, 1)
        setPrevDeleted({ item: removed, index })
        // clear any previous single-undo timer
        if (singleUndoTimerRef.current) {
          clearTimeout(singleUndoTimerRef.current)
        }
        singleUndoTimerRef.current = window.setTimeout(() => {
          setPrevDeleted(null)
          singleUndoTimerRef.current = null
          try { setToast(null) } catch {}
        }, 8000)
      }
      try { localStorage.setItem('recentChecks', JSON.stringify(next)) } catch {}
      return next
    })
    setToast('Removed check')
  }

  function undoSingleRemove() {
    if (!prevDeleted) return
    const { item, index } = prevDeleted
    setRecentChecks((prev) => {
      const next = [...prev]
      // re-insert at original index (or push if out of bounds)
      const insertAt = Math.min(Math.max(0, index), next.length)
      next.splice(insertAt, 0, item)
      try { localStorage.setItem('recentChecks', JSON.stringify(next)) } catch {}
      return next
    })
    setPrevDeleted(null)
    if (singleUndoTimerRef.current) {
      clearTimeout(singleUndoTimerRef.current)
      singleUndoTimerRef.current = null
    }
    setToast('Restored check')
    setTimeout(() => setToast(null), 1200)
  }

  // Google Identity Services integration (client-side)
  function loadGoogleScriptOnce(cb: () => void) {
    if ((window as any).google) return cb()
    const existing = document.querySelector('script[data-gsi]')
    if (existing) {
      existing.addEventListener('load', cb)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.setAttribute('data-gsi', '1')
    s.async = true
    s.defer = true
    s.onload = cb
    document.head.appendChild(s)
  }

  // Capture global errors to help debug Google sign-in issues
  useEffect(() => {
    function onErr(ev: ErrorEvent) {
      try { setGsiError(`${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}`) } catch { setGsiError(String(ev)) }
    }
    function onRej(ev: PromiseRejectionEvent) {
      try { setGsiError(`unhandledrejection: ${String(ev.reason)}`) } catch { setGsiError(String(ev)) }
    }
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  function handleCredentialResponse(credential: string) {
    try {
      // Save id token and parse payload for name/email (no verification client-side)
      setIdToken(credential)
      localStorage.setItem('fg_id_token', credential)
      const payload = JSON.parse(atob(credential.split('.')[1]))
      const u = { name: payload.name || payload.email, email: payload.email }
      setUser(u)
      localStorage.setItem('fg_user', JSON.stringify(u))
      setToast('Signed in')
      setTimeout(() => setToast(null), 1200)
    } catch (e) {
      console.error('Failed to process credential', e)
    }
  }

  function startGoogleSignIn() {
    if (!googleClientId) {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
      const cid = prompt(`Enter Google OAuth Client ID for this app (must be configured for ${origin})`)
      if (!cid) return
      setGoogleClientId(cid)
      try { localStorage.setItem('fg_google_cid', cid) } catch {}
    }
    loadGoogleScriptOnce(() => {
      const g = (window as any).google
      if (!g) return
      g.accounts.id.initialize({
        client_id: googleClientId || localStorage.getItem('fg_google_cid'),
        callback: (resp: any) => handleCredentialResponse(resp.credential),
        cancel_on_tap_outside: false,
      })
      // render a one-time button into our container if present
      if (googleButtonRef.current) {
        // clear previous
        googleButtonRef.current.innerHTML = ''
        g.accounts.id.renderButton(googleButtonRef.current, { theme: 'outline', size: 'medium' })
        setGsiRendered(true)
      }
      // optionally prompt the one-tap
      g.accounts.id.prompt()
    })
  }

  // Auto-render the GSI button when a client ID is known (dev convenience)
  useEffect(() => {
    if (googleClientId && !gsiRendered) {
      // defer slightly to ensure the button container is mounted
      const t = window.setTimeout(() => startGoogleSignIn(), 100)
      return () => window.clearTimeout(t)
    }
  }, [googleClientId, gsiRendered])
        

  // Simple doughnut chart to visualize risk distribution from recentChecks
  function RiskDoughnutChart({ items }: { items: TransactionResponse[] }) {
    const counts = { LOW: 0, MEDIUM: 0, HIGH: 0 }
    items.forEach((it) => {
      const lvl = (it.risk_level || 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH'
      counts[lvl] = (counts[lvl] ?? 0) + 1
    })
    const total = Math.max(1, counts.LOW + counts.MEDIUM + counts.HIGH)
    const data = [
      { name: 'Low', value: counts.LOW, color: '#16a34a' },
      { name: 'Medium', value: counts.MEDIUM, color: '#f59e0b' },
      { name: 'High', value: counts.HIGH, color: '#ef4444' },
    ]


    return (
      <div className="w-full max-w-sm mx-auto">
          <div className="text-sm font-medium text-slate-700 mb-2">Risk Distribution</div>
          <div className="risk-chart-container flex justify-center items-center risk-chart-size">
            <div className="risk-chart-inner">
              <PieChart width={220} height={180}>
              <Pie
                data={data}
                innerRadius={50}
                outerRadius={70}
                dataKey="value"
                nameKey="name"
                paddingAngle={2}
                labelLine={false}
                label={false}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number | undefined) => value !== undefined ? `${Math.round((value / total) * 100)}%` : ''} />
              <Legend verticalAlign="bottom" height={24} />
              </PieChart>
            </div>
          </div>
        <div className="text-xs text-slate-500 text-center mt-2">Total Transactions: {total}</div>
      </div>
    )
  }
        

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-white flex items-center justify-center p-8 antialiased text-slate-800">
      <div className="w-full max-w-5xl">
        <div className="bg-white/80 backdrop-blur-sm border border-slate-100 shadow-xl rounded-2xl overflow-hidden">
          <header className="mb-6 text-center px-6 pt-8">
            <h1 className="text-4xl md:text-5xl font-extrabold font-serif tracking-tight text-slate-900">FinGuard</h1>
            <p className="text-slate-600 mt-2 max-w-2xl mx-auto">Enterprise-grade transaction risk checks — fast, auditable, and reliable.</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-4">
            {user ? (
              <div className="text-sm text-slate-600">Signed in as <strong>{user.name}</strong> · <button onClick={() => { setUser(null); setIdToken(null); localStorage.removeItem('fg_user'); localStorage.removeItem('fg_id_token') }} className="underline ml-2">Sign out</button></div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  {!gsiRendered ? (
                    <button onClick={startGoogleSignIn} className="px-4 py-2 rounded-md bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 hover:scale-105 transform transition">Sign in with Google</button>
                  ) : null}
                </div>
                <div className="text-sm text-slate-500">Uses Google Sign-In ID token; configure an OAuth Client ID for your local origin.</div>
                <div ref={googleButtonRef} className="mt-2" />
                {gsiError ? (
                  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 w-full max-w-md">
                    <div className="font-semibold text-sm">Google Sign-In error</div>
                    <pre className="whitespace-pre-wrap text-xs mt-1">{gsiError}</pre>
                    <div className="text-xs mt-2">Check Authorized JavaScript origins, Test users, and project/billing status.</div>
                  </div>
                ) : null}
                {!user && !idToken ? (
                  <div className="text-sm text-slate-500 mt-1">Requests will use a demo user for local testing (no Google sign-in required).</div>
                ) : null}
              </div>
            )}
            </div>
          </header>

        <section className="bg-white shadow-lg rounded-xl overflow-hidden">
            <div className="p-6 sm:p-8 grid gap-6 sm:grid-cols-2 items-start">
            <form onSubmit={onSubmit} className="sm:col-span-1">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">Amount</label>
                  <div className="mt-1">
                    <input
                      inputMode="decimal"
                      type="number"
                      step="0.01"
                      min="0"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="12.50"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label="Amount"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Merchant</label>
                  <div className="mt-1">
                    <input
                      type="text"
                      value={merchant}
                      onChange={(e) => setMerchant(e.target.value)}
                      placeholder="Coffee Shop"
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label="Merchant"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={!valid || loading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {loading ? (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                        <path d="M4 12a8 8 0 018-8" strokeWidth="4" className="opacity-75" />
                      </svg>
                    ) : null}
                    <span>{loading ? 'Checking…' : 'Check Risk'}</span>
                  </button>
                  <div className="text-sm text-slate-500">Sends to <code>/transactions</code></div>
                </div>

                <div aria-live="polite">
                  {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
                </div>
              </div>
            </form>

            <div className="sm:col-span-1 border-l border-slate-100 pl-6">
              <div className="flex flex-col items-center gap-4">
                <RiskDoughnutChart items={recentChecks} />
                <h3 className="text-sm font-medium text-slate-700">Latest result</h3>
              <div className="mt-3">
                {result ? (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{result.merchant}</div>
                      <div className="text-sm text-slate-500">{formatCurrency(result.amount)} • {result.currency}</div>
                    </div>
                    <div>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${riskColor}`}>
                        {riskLevel === 'HIGH' ? 'High Risk' : riskLevel === 'MEDIUM' ? 'Medium Risk' : 'Low Risk'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">No check performed yet — submit a transaction to see the result.</div>
                )}
              </div>
                <div className="mt-4 flex items-center gap-2">
                  {result ? (
                    <>
                      <button ref={copyRef} onClick={copyResult} className="px-3 py-1 text-sm rounded-md bg-slate-100">Copy JSON</button>
                      <button onClick={() => { setResult(null); setRiskLevel(null); setRiskColor('bg-gray-100') }} className="px-3 py-1 text-sm rounded-md bg-slate-50">Clear</button>
                    </>
                  ) : null}
                  <div className="ml-auto text-xs text-slate-400">Tip: Use realistic merchant names and amounts for better demo results.</div>
                </div>
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs text-slate-500 mb-2">Recent checks</h4>
                  {recentChecks.length > 0 ? (
                    <button onClick={clearRecentChecks} className="text-xs text-slate-500 hover:text-slate-700">Clear all checks</button>
                  ) : null}
                </div>
                <div className="space-y-2 flex flex-col items-center">
                  {recentChecks.length === 0 ? (
                    <div className="text-xs text-slate-400">No recent checks</div>
                  ) : (
                    recentChecks.map((r, i) => (
                      <div
                          key={i}
                          className={`w-full max-w-md flex items-center justify-between text-sm p-3 rounded-md shadow-sm transition hover:shadow-md transform hover:-translate-y-0.5 ${
                          r.risk_level === 'HIGH'
                            ? 'border-l-4 border-red-400 bg-red-50'
                            : r.risk_level === 'MEDIUM'
                            ? 'border-l-4 border-yellow-400 bg-yellow-50'
                            : 'border-l-4 border-emerald-400 bg-emerald-50'
                        }`}
                      >
                        <div>
                          <div className="font-medium">{r.merchant}</div>
                          <div className="text-xs text-slate-500">{formatCurrency(r.amount)} • {r.currency}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          {r.risk_level === 'HIGH' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">High</span>
                          ) : r.risk_level === 'MEDIUM' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">Medium</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">Low</span>
                          )}

                          <button
                            onClick={() => removeRecentCheck(i)}
                            aria-label="Remove check"
                            title="Remove"
                            className="p-1 rounded-md hover:bg-red-50 text-red-600"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                              <path d="M9 3v1H4v2h16V4h-5V3H9zm-3 6v10a2 2 0 002 2h8a2 2 0 002-2V9H6z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
        </section>
        {toast ? (
          <div className="fixed top-6 right-6 bg-slate-900 text-white px-4 py-2 rounded-md shadow-lg flex items-center gap-3">
            <div>{toast}</div>
            {prevChecks ? (
              <button onClick={undoClear} className="underline text-sm">Undo</button>
            ) : prevDeleted ? (
              <button onClick={undoSingleRemove} className="underline text-sm">Undo</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  </div>
  )
}
