// supabase/functions/create-project/index.ts
// Inserts a new project using the service_role key, bypassing RLS.
// Azure AD JWTs are not Supabase JWTs — we skip getUser() and parse
// the user id directly from the JWT payload instead.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Pull the `oid` or `sub` claim out of the JWT without verifying the signature.
 *  We only use this for the created_by audit column — not for access control.  */
function parseJwtPayload(authHeader: string): Record<string, unknown> | null {
  try {
    const token   = authHeader.replace(/^Bearer\s+/i, '')
    const [, b64] = token.split('.')
    const json    = atob(b64.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  try {
    // ── 1. Require Authorization header ───────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Parse user id from JWT payload for the audit column.
    // Azure AD tokens use `oid` as the stable user identifier.
    const payload   = parseJwtPayload(authHeader)
    const callerUid = (payload?.oid ?? payload?.sub ?? null) as string | null

    // ── 2. Parse and validate the payload ─────────────────────────────────
    const body = await req.json()
    const {
      division,
      status,
      project_address,
      scope_type,
      property_manager_owner,
      architect_engineer,
      bid_amount,
      notes,
      walkthrough_date = null,
      due_date         = null,
      bid_submitted    = false,
    } = body

    if (!project_address?.trim()) {
      return new Response(JSON.stringify({ error: 'project_address is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Insert using service_role — bypasses RLS entirely ──────────────
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data, error } = await adminClient
      .from('projects')
      .insert([{
        division:               division ?? 'regular',
        status:                 status ?? 'New Bid',
        project_address:        project_address.trim(),
        scope_type:             scope_type ?? null,
        property_manager_owner: property_manager_owner?.trim() || null,
        architect_engineer:     architect_engineer?.trim() || null,
        bid_amount:             bid_amount ? Number(bid_amount) : null,
        notes:                  notes?.trim() || null,
        walkthrough_date,
        due_date,
        bid_submitted,
        current_stage:          1,
        created_by:             callerUid,
      }])
      .select('id')
      .single()

    if (error) {
      console.error('Insert error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ id: data.id }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})