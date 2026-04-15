const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Extract the Azure AD provider token from a Supabase session object */
export const getProviderToken = (session) => session?.provider_token ?? null;

/** Sanitize project number + address into a safe SharePoint folder name */
export function sanitizeFolderName(projectNumber, address) {
  return `${projectNumber}_${address}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/, "")
    .substring(0, 240);
}

/**
 * List contents of a SharePoint folder by folder item ID.
 * Used in ProjectDetail documents tab.
 */
export async function listFolderContents(providerToken, siteId, driveId, folderId) {
  const res = await fetch(
    `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/items/${folderId}/children?$orderby=name`,
    { headers: { Authorization: `Bearer ${providerToken}` } },
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message ?? `Graph ${res.status}`);
  }
  const data = await res.json();
  return data.value.map((item) => ({
    id:           item.id,
    name:         item.name,
    size:         item.size,
    webUrl:       item.webUrl,
    isFolder:     !!item.folder,
    lastModified: item.lastModifiedDateTime,
    createdBy:    item.createdBy?.user?.displayName ?? null,
  }));
}

/**
 * Upload a file (< 4 MB) to a SharePoint folder.
 * For larger files use the resumable upload session pattern.
 */
export async function uploadFileToFolder(providerToken, siteId, driveId, folderId, file) {
  const res = await fetch(
    `${GRAPH_BASE}/sites/${siteId}/drives/${driveId}/items/${folderId}:/${encodeURIComponent(file.name)}:/content`,
    {
      method:  "PUT",
      headers: {
        Authorization:  `Bearer ${providerToken}`,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message ?? `Upload failed ${res.status}`);
  }
  return await res.json();
}

// ── Discovery utilities — run from browser console once to get env var values ──

export async function discoverSiteId(providerToken, hostname, sitePath) {
  const res = await fetch(`${GRAPH_BASE}/sites/${hostname}:${sitePath}`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  const d = await res.json();
  return { siteId: d.id, displayName: d.displayName, webUrl: d.webUrl };
}

export async function listSiteDrives(providerToken, siteId) {
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drives`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  const d = await res.json();
  return d.value.map((x) => ({ id: x.id, name: x.name, webUrl: x.webUrl }));
}

export async function listSharePointLists(providerToken, siteId) {
  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/lists`, {
    headers: { Authorization: `Bearer ${providerToken}` },
  });
  const d = await res.json();
  return d.value.map((x) => ({ id: x.id, name: x.displayName }));
}
