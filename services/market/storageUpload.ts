import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { supabase } from "@/services/supabase";

type UploadParams = {
  bucket: string;
  path: string;
  localUri: string;
  contentType?: string;
  upsert?: boolean;
};

function withTimeout<T>(p: Promise<T>, ms: number, label = "Operation") {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function base64ToUint8Array(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const str = base64.replace(/=+$/, "");
  const bytesLength = (str.length * 3) >> 2;
  const bytes = new Uint8Array(bytesLength);

  let p = 0;
  for (let i = 0; i < str.length; i += 4) {
    const enc1 = chars.indexOf(str[i]);
    const enc2 = chars.indexOf(str[i + 1]);
    const enc3 = chars.indexOf(str[i + 2] || "A");
    const enc4 = chars.indexOf(str[i + 3] || "A");

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    bytes[p++] = chr1;
    if (str[i + 2] !== undefined) bytes[p++] = chr2;
    if (str[i + 3] !== undefined) bytes[p++] = chr3;
  }

  return bytes.slice(0, p);
}

async function readFileAsBytesViaFetch(localUri: string) {
  const res = await withTimeout(fetch(localUri, { cache: "no-store" }), 120_000, "Reading file");
  if (!res.ok) {
    throw new Error(`Reading file failed (HTTP ${res.status})`);
  }
  const buf = await withTimeout(res.arrayBuffer(), 120_000, "Reading file bytes");
  return new Uint8Array(buf);
}

async function readFileAsBytesViaFileSystem(localUri: string) {
  const base64 = await withTimeout(
    FileSystem.readAsStringAsync(localUri, {
        encoding: "base64" as any,
      }),
    120_000,
    "Reading file",
  );
  return base64ToUint8Array(base64);
}

async function readFileAsBytes(localUri: string) {
  const rawUri = String(localUri || "");
  let preparedUri = rawUri;
  let cleanupUri: string | null = null;

  if (Platform.OS !== "web" && /^content:\/\//i.test(rawUri) && FileSystem.cacheDirectory) {
    const ext = rawUri.split(".").pop()?.split("?")[0] || "bin";
    preparedUri = `${FileSystem.cacheDirectory}supabase-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
    try {
      await withTimeout(FileSystem.copyAsync({ from: rawUri, to: preparedUri }), 60_000, "Preparing file");
      cleanupUri = preparedUri;
    } catch (e) {
      console.log("[readFileAsBytes] File copy failed, trying original URI", String((e as any)?.message || e));
      preparedUri = rawUri;
    }
  }

  try {
    try {
      return await readFileAsBytesViaFetch(preparedUri);
    } catch (e) {
      if (Platform.OS === "web") throw e;
      console.log("[readFileAsBytes] Fetch failed, trying FileSystem", String((e as any)?.message || e));
      return await readFileAsBytesViaFileSystem(preparedUri);
    }
  } finally {
    if (cleanupUri) {
      await FileSystem.deleteAsync(cleanupUri, { idempotent: true }).catch(() => undefined);
    }
  }
}

export async function uploadToSupabaseStorage(params: UploadParams) {
  const { bucket, path, localUri, contentType = "image/jpeg", upsert = true } = params;

  try {
    const { data: sess, error: sessErr } = await withTimeout(supabase.auth.getSession(), 15_000, "Auth session check");
    if (sessErr) throw new Error(`Authentication failed: ${sessErr.message}`);
    if (!sess.session) throw new Error("No session. Please sign in again.");

    console.log("[uploadToSupabaseStorage] Reading file:", { path, contentType });
    const bytes = await readFileAsBytes(localUri);
    console.log("[uploadToSupabaseStorage] File read successfully:", { path, sizeBytes: bytes.length });

    const uploadPromise = supabase.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert,
    });

    console.log("[uploadToSupabaseStorage] Uploading to Supabase:", { bucket, path });
    const { error: uploadErr } = await withTimeout(uploadPromise, 240_000, "Storage upload");
    if (uploadErr) {
      console.error("[uploadToSupabaseStorage] Upload error:", uploadErr);
      throw new Error(`Upload failed: ${uploadErr.message}`);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    console.log("[uploadToSupabaseStorage] Upload completed successfully:", { path });
    return { publicUrl: data?.publicUrl ?? null, storagePath: path };
  } catch (err: any) {
    console.error("[uploadToSupabaseStorage] Error:", err);
    throw err;
  }
}

export async function uploadImageToSupabase(params: UploadParams): Promise<string> {
  const { publicUrl } = await uploadToSupabaseStorage(params);
  if (!publicUrl) throw new Error("Failed to get public URL");
  return publicUrl;
}

export const uploadListingImage = uploadImageToSupabase;
