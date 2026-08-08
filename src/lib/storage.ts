import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** One year — signed URLs are minted fresh on every page load anyway. */
export const DEFAULT_EXPIRY = 31536000;

/** Converts any Supabase storage URL (public/sign/authenticated) to a clean path. */
export function extractStoragePath(urlOrPath: string | null | undefined, bucket?: string): string {
  if (!urlOrPath) return "";
  if (!urlOrPath.startsWith("http")) return urlOrPath;

  const seg = bucket ? bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[^/]+";
  const patterns = [
    new RegExp(`/object/public/${seg}/(.+?)(?:\\?|$)`),
    new RegExp(`/object/sign/${seg}/(.+?)(?:\\?|$)`),
    new RegExp(`/object/authenticated/${seg}/(.+?)(?:\\?|$)`),
  ];
  for (const p of patterns) {
    const m = urlOrPath.match(p);
    if (m) return decodeURIComponent(m[1]);
  }
  return urlOrPath;
}

export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = DEFAULT_EXPIRY,
): Promise<string | null> {
  const clean = extractStoragePath(path, bucket);
  if (!clean || clean.trim() === "") return null;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(clean, expiresIn);
  if (error || !data?.signedUrl) {
    console.error(`[storage] signed URL failed for ${bucket}/${clean}`, error);
    return null;
  }
  return data.signedUrl;
}

/** Batch: returns a map keyed by the ORIGINAL path/url passed in. */
export async function getSignedUrls(
  bucket: string,
  paths: string[],
  expiresIn: number = DEFAULT_EXPIRY,
): Promise<Record<string, string>> {
  if (!paths || paths.length === 0) return {};
  const originals = paths.filter(Boolean);
  const clean = originals.map((p) => extractStoragePath(p, bucket)).filter(Boolean);
  if (clean.length === 0) return {};

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(clean, expiresIn);
  if (error || !data) {
    console.error("[storage] batch signed URL error", error);
    return {};
  }
  const result: Record<string, string> = {};
  data.forEach((item, i) => {
    if (item.signedUrl) result[originals[i]] = item.signedUrl;
  });
  return result;
}

export function useSignedUrl(bucket: string | null, path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!bucket || !path) {
      setUrl(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    getSignedUrl(bucket, path)
      .then((signed) => {
        if (cancelled) return;
        setUrl(signed);
        setError(!signed);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucket, path]);

  return { url, loading, error };
}

export function useSignedUrls(bucket: string | null, paths: string[]) {
  const key = useMemo(() => paths.filter(Boolean).join("|"), [paths]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const list = key ? key.split("|") : [];
    if (!bucket || list.length === 0) {
      setUrls({});
      setLoading(false);
      return;
    }
    setLoading(true);
    getSignedUrls(bucket, list)
      .then((map) => { if (!cancelled) setUrls(map); })
      .catch((err) => console.error("[storage] useSignedUrls", err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucket, key]);

  return { urls, loading };
}
