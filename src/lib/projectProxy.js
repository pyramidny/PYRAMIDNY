// src/lib/projectProxy.js
// Routes project INSERT and UPDATE through the Edge Function
// because Azure AD tokens aren't recognised by PostgREST directly.
// Milestone UPDATEs are fine as direct Supabase calls (rows pre-exist).

const PROXY_URL =
  "https://izjaxmcdlsdkdliqjlei.supabase.co/functions/v1/project-proxy";

async function callProxy(payload, accessToken) {
  const res = await fetch(PROXY_URL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Proxy error ${res.status}`);
  return json.data;
}

export async function proxyInsertProject(projectData, accessToken) {
  return callProxy(
    { action: "insert", table: "projects", data: projectData },
    accessToken
  );
}

export async function proxyUpdateProject(id, updates, accessToken) {
  return callProxy(
    { action: "update", table: "projects", id, data: updates },
    accessToken
  );
}