import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PRIVATE_BUCKETS = ["rh-photos", "rh-assets", "hotel-assets"] as const;
type PrivateBucket = (typeof PRIVATE_BUCKETS)[number];

/** Extracts { bucket, path } from a stored value that may be either a raw
 *  storage path or a legacy public URL like
 *  https://xxx.supabase.co/storage/v1/object/public/<bucket>/<path>. */
export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket?: PrivateBucket,
): { bucket: PrivateBucket; path: string } | null {
  if (!value) return null;
  const m = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (m) {
    const bucket = m[1] as PrivateBucket;
    if ((PRIVATE_BUCKETS as readonly string[]).includes(bucket)) {
      return { bucket, path: decodeURIComponent(m[2]) };
    }
    return null;
  }
  if (defaultBucket) return { bucket: defaultBucket, path: value };
  return null;
}

export async function getSignedPrivateUrl(
  value: string | null | undefined,
  defaultBucket?: PrivateBucket,
  expiresIn = 3600,
): Promise<string | null> {
  const ref = parseStorageRef(value, defaultBucket);
  if (!ref) return value ?? null;
  const { data } = await supabase.storage.from(ref.bucket).createSignedUrl(ref.path, expiresIn);
  return data?.signedUrl ?? null;
}

export function useSignedPrivateUrl(
  value: string | null | undefined,
  defaultBucket?: PrivateBucket,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setUrl(null);
      return;
    }
    const ref = parseStorageRef(value, defaultBucket);
    if (!ref) {
      setUrl(value);
      return;
    }
    supabase.storage.from(ref.bucket).createSignedUrl(ref.path, 3600).then(({ data }) => {
      if (!cancelled) setUrl(data?.signedUrl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [value, defaultBucket]);
  return url;
}