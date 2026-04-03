# Pyramid Restoration Portal

Project management PWA for Pyramid Restoration Specialists.

**Stack:** Vite + React · Tailwind CSS · Supabase (Postgres + Auth) · Azure AD SSO · Netlify

---

## Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Start dev server
npm run dev
```

## Environment Variables

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |

Set both in **Netlify → Site Settings → Environment Variables** for production.

---

## Azure AD SSO Setup

1. In Supabase Dashboard → Authentication → Providers → Azure:
   - Paste your Azure App Registration **Client ID** and **Client Secret**
   - Copy the **Redirect URL** shown (e.g. `https://xxx.supabase.co/auth/v1/callback`)

2. In Azure Portal → App Registration → Authentication:
   - Add the Supabase redirect URL as a **Web** redirect URI
   - Add `https://app.pyramidny.com` as an allowed origin

3. In Azure Portal → API Permissions:
   - Add `email`, `profile`, `openid` (delegated)
   - Grant admin consent

---

## Deploy to Netlify

1. Push this repo to GitHub
2. Connect repo to Netlify
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add environment variables in Netlify dashboard
6. Set custom domain: `app.pyramidny.com`

---

## Project Structure

```
src/
├── lib/
│   └── supabase.js          # Supabase client singleton
├── context/
│   └── AuthContext.jsx      # Auth state, Azure SSO, profile
├── components/
│   ├── Layout.jsx           # App shell with sidebar
│   ├── Sidebar.jsx          # Nav, user footer
│   └── ProtectedRoute.jsx   # Auth gate
└── pages/
    ├── Login.jsx            # Azure AD SSO login
    ├── Dashboard.jsx        # Home screen
    ├── ProjectList.jsx      # Filterable project table
    └── Placeholders.jsx     # ProjectDetail, MyTasks, Team, Settings
```

---

## Icons

Place PWA icons in `public/icons/`:
- `icon-192.png` (192×192)
- `icon-512.png` (512×512)

Generate from the pyramid SVG in `public/favicon.svg` using [PWA Asset Generator](https://github.com/elegantapp/pwa-asset-generator) or Figma export.
