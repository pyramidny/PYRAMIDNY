// supabase/functions/upsert-production/index.ts
// Upserts a row in project_production using service_role key (bypasses RLS).
// Called when a PM clicks a checklist item on ProjectDetail.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CHECKLIST_FIELDS = new Set([
  'project_transfer',
  'coi_requested',
  'cci_requested',
  'submittals',
  'informational_package',
  'logistical_plan',
  'dob_permits',
  'dot_permits',
  'cd5',
  'retainage_closeout',
])

const VALID_VALUES = new Set(['Yes', 'No', 'N/A', null])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()
    const { project_id, ...rest } = body

    if (!project_id) {
      return new Response(JSON.stringify({ error: 'project_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const updates: Record<string, unknown> = { project_id }
    for (const [key, val] of Object.entries(rest)) {
      if (CHECKLIST_FIELDS.has(key) && VALID_VALUES.has(val as string | null)) {
        updates[key] = val
      }
    }

    if (Object.keys(updates).length <= 1) {
      return new Response(JSON.stringify({ error: 'No valid checklist fields provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { error } = await adminClient
      .from('project_production')
      .upsert(updates, { onConflict: 'project_id' })

    if (error) {
      console.error('Upsert error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
