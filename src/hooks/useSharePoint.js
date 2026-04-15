import { useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { listFolderContents, uploadFileToFolder } from "../lib/sharepoint";

const SP_SITE_ID  = import.meta.env.VITE_SP_SITE_ID  ?? "";
const SP_DRIVE_ID = import.meta.env.VITE_SP_DRIVE_ID ?? "";

export function useSharePoint() {
  const { session } = useAuth();
  const [files,   setFiles]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const providerToken = session?.provider_token ?? null;
  const hasToken      = !!providerToken;
  const configured    = !!(SP_SITE_ID && SP_DRIVE_ID);

  const loadFolder = useCallback(
    async (folderId) => {
      if (!providerToken || !folderId || !configured) return;
      setLoading(true);
      setError(null);
      try {
        const items = await listFolderContents(providerToken, SP_SITE_ID, SP_DRIVE_ID, folderId);
        setFiles(items);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [providerToken, configured],
  );

  const uploadFile = useCallback(
    async (folderId, file) => {
      if (!providerToken || !folderId) throw new Error("Not authenticated or no folder");
      const result = await uploadFileToFolder(
        providerToken, SP_SITE_ID, SP_DRIVE_ID, folderId, file,
      );
      // Refresh listing after upload
      await loadFolder(folderId);
      return result;
    },
    [providerToken, loadFolder],
  );

  return { files, loading, error, loadFolder, uploadFile, hasToken, configured };
}
