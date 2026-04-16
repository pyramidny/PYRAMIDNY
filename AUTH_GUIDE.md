# Azure AD + Supabase PKCE Auth — Definitive Guide
## Kane PC / April 2026 — Confirmed working on Pyramid + applicable to DiamondMSP

This documents the exact pattern that works after an exhausting debug session.
Do not deviate from this without good reason.

---

## The Core Problem

Azure AD issues Microsoft-signed JWTs. Supabase's PostgREST treats them as
anonymous — so all DB writes must go through Edge Functions with service_role.
The PKCE flow also has several gotchas with React + Supabase that will bite you.

---

## 1. supabase.js — Three Required Settings

```js
export const supabase = createClient(url, anon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,   // Supabase auto-exchanges ?code= on init
    flowType: 'pkce',
    // CRITICAL: bypass Web Locks API or AuthContext + auto-exchange
    // will compete for the same lock and one will kill the other
    lock: async (_name, _timeout, fn) => fn(),
  },
})
```

---

## 2. AuthCallback.jsx — Watch Context, Hard Redirect

```jsx
import { useEffect, useRef } from 'react'
import { useAuth } from '@/context/AuthContext'

export function AuthCallback() {
  const { session } = useAuth()
  const fallback = useRef(null)

  useEffect(() => {
    if (session) {
      clearTimeout(fallback.current)
      // CRITICAL: hard redirect, NOT navigate()
      // navigate() leaves Supabase client in partial state — dashboard stalls
      // window.location.href forces full reload, client re-inits cleanly
      window.location.href = '/dashboard'
      return
    }
    if (!fallback.current) {
      fallback.current = setTimeout(() => {
        window.location.href = '/login'
      }, 12000)
    }
  }, [session])

  useEffect(() => () => clearTimeout(fallback.current), [])

  return <Spinner />
}
```

---

## 3. App.jsx — Never Block /auth/callback

```jsx
export default function App() {
  const { loading } = useAuth()
  const location = useLocation()

  // Catch ?code= landing at root (Supabase sometimes does this)
  if (location.pathname === '/' && location.search.includes('code=')) {
    return <Navigate to={`/auth/callback${location.search}`} replace />
  }

  // NEVER block /auth/callback — it must mount to catch the session
  const isCallback = location.pathname === '/auth/callback'
  if (loading && !isCallback) return null

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* protected routes... */}
    </Routes>
  )
}
```

---

## 4. AuthContext.jsx — Keep It Simple

```js
useEffect(() => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    setSession(session)
    if (session?.user) loadProfile(session.user.id)
    setLoading(false)
  })

  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (_event, session) => {
      setSession(session)
      if (session?.user) await loadProfile(session.user.id)
      else setProfile(null)
      setLoading(false)
    }
  )
  return () => subscription.unsubscribe()
}, [])
```

**Do NOT add setLoading(true) inside onAuthStateChange** — it blocks /auth/callback.

---

## 5. main.jsx — No StrictMode

```jsx
// StrictMode removed — double-invokes effects, causes two simultaneous
// lock acquisitions that kill the PKCE exchange
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
)
```

Also unregister any service workers on boot if you ever had VitePWA installed:
```js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then(regs => regs.forEach(r => r.unregister()))
}
```

---

## 6. vite.config.js — No VitePWA

VitePWA generates sw.js. If SSL cert is not fully provisioned, sw.js will throw
a SecurityError that poisons the fetch stack and kills exchangeCodeForSession.
Just remove VitePWA from internal staff portals — they don't need offline mode.

---

## 7. Supabase Dashboard Settings

- **Site URL:** https://yourdomain.com (must be HTTPS)
- **Redirect URLs:** Add BOTH:
  - https://yourdomain.com/* (wildcard)
  - https://yourdomain.com/auth/callback (exact — wildcards alone are unreliable)
  - Same for any Netlify subdomain used for testing

---

## 8. Azure AD App Registration

- **Redirect URIs (Web):**
  - https://yourdomain.com/auth/callback
  - https://yourproject.netlify.app/auth/callback
  - https://[supabase-ref].supabase.co/auth/v1/callback ← REQUIRED
- **Implicit grant:** Uncheck BOTH Access tokens and ID tokens
- **Admin consent:** Grant for Sites.ReadWrite.All + Files.ReadWrite if using SharePoint

---

## 9. DNS — Cloudflare Required for Netlify SSL

GoDaddy DNS → Netlify SSL provisioning fails silently.
Move domain to Cloudflare (free), set CNAME to yourproject.netlify.app as
DNS-only (gray cloud, not proxied). Netlify will provision cert in < 2 min.

---

## Why Each Decision Was Made

| Decision | Why |
|---|---|
| `detectSessionInUrl: true` | Supabase handles exchange internally — no manual exchangeCodeForSession needed |
| `lock: fn => fn()` | Prevents AuthContext.getSession and auto-exchange competing for same Web Lock |
| `window.location.href` not `navigate()` | React Router soft nav leaves Supabase in partial state, dashboard stalls |
| No StrictMode | Double-effect invocation causes two simultaneous lock acquisitions |
| No VitePWA | sw.js SSL errors poison fetch stack on /auth/callback |
| Cloudflare DNS | GoDaddy can't complete Netlify ACME challenge for Let's Encrypt |
| Exact redirect URL | Supabase wildcards alone sometimes strip the path from redirect |
