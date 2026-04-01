import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { supabase, supabaseAnonKey, supabaseUrl } from "@/services/supabase";

type UploadParams = {
  bucket: string;
  path: string;
  localUri: string;
  fileBody?: Blob | null;
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

function normalizeContentType(value?: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "image/jpeg";
  if (raw.includes("/")) return raw;
  if (raw.endsWith(".mp4")) return "video/mp4";
  if (raw.endsWith(".mov")) return "video/quicktime";
  if (raw.endsWith(".webm")) return "video/webm";
  if (raw.endsWith(".m4v")) return "video/x-m4v";
  if (raw.endsWith(".avi")) return "video/x-msvideo";
  if (raw.endsWith(".mkv")) return "video/x-matroska";
  if (raw.endsWith(".png")) return "image/png";
  if (raw.endsWith(".webp")) return "image/webp";
  if (raw.endsWith(".heic") || raw.endsWith(".heif")) return "image/heic";
  if (raw.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function buildStorageUploadUrl(bucket: string, path: string) {
  const base = String(supabaseUrl || (supabase as any)?.supabaseUrl || "").replace(/\/+$/, "");
  const objectPath = [bucket, ...String(path || "").split("/").filter(Boolean).map(encodeURIComponent)].join("/");
  return `${base}/storage/v1/object/${objectPath}`;
}

function extractUploadErrorMessage(body: string) {
  const raw = String(body || "").trim();
  if (!raw) return "Upload failed.";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.message || parsed?.error || raw);
  } catch {
    return raw;
  }
}

async function prepareUploadUri(localUri: string) {
  const rawUri = String(localUri || "");
  let preparedUri = rawUri;
  let cleanupUri: string | null = null;

  if (Platform.OS !== "web" && FileSystem.cacheDirectory && !/^file:\/\//i.test(rawUri)) {
    const ext = rawUri.split(".").pop()?.split("?")[0] || "bin";
    preparedUri = `${FileSystem.cacheDirectory}supabase-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
    try {
      await withTimeout(FileSystem.copyAsync({ from: rawUri, to: preparedUri }), 300_000, "Preparing file");
      cleanupUri = preparedUri;
    } catch (e) {
      console.log("[prepareUploadUri] File copy failed, trying original URI", String((e as any)?.message || e));
      preparedUri = rawUri;
    }
  }

  return {
    preparedUri,
    cleanupUri,
  };
}

async function cleanupPreparedUploadUri(cleanupUri: string | null) {
  if (!cleanupUri) return;
  await FileSystem.deleteAsync(cleanupUri, { idempotent: true }).catch(() => undefined);
}

async function uploadViaNativeFileTransfer(params: {
  bucket: string;
  path: string;
  localUri: string;
  contentType: string;
  accessToken: string;
  upsert: boolean;
}) {
  const { bucket, path, localUri, contentType, accessToken, upsert } = params;
  const { preparedUri, cleanupUri } = await prepareUploadUri(localUri);

  try {
    if (!/^file:\/\//i.test(preparedUri)) {
      throw new Error("Native upload requires a local file URI.");
    }

    const uploadUrl = buildStorageUploadUrl(bucket, path);
    const response = await withTimeout(
      FileSystem.uploadAsync(uploadUrl, preparedUri, {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: supabaseAnonKey,
          "content-type": contentType,
          "cache-control": "max-age=3600",
          "x-upsert": String(upsert),
        },
      }),
      900_000,
      "Native storage upload",
    );

    if (!response) {
      throw new Error("Native upload was cancelled.");
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Upload failed: ${extractUploadErrorMessage(response.body)}`);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { publicUrl: data?.publicUrl ?? null, storagePath: path };
  } finally {
    await cleanupPreparedUploadUri(cleanupUri);
  }
}

async function readFileAsBytesViaFetch(localUri: string) {
  const res = await withTimeout(fetch(localUri, { cache: "no-store" }), 300_000, "Reading file");
  if (!res.ok) {
    throw new Error(`Reading file failed (HTTP ${res.status})`);
  }
  const buf = await withTimeout(res.arrayBuffer(), 300_000, "Reading file bytes");
  return new Uint8Array(buf);
}

async function readFileAsBytesViaFileSystem(localUri: string) {
  const base64 = await withTimeout(
    FileSystem.readAsStringAsync(localUri, {
        encoding: "base64" as any,
      }),
    300_000,
    "Reading file",
  );
  return base64ToUint8Array(base64);
}

async function uploadViaWebBlob(params: {
  bucket: string;
  path: string;
  fileBody: Blob;
  contentType: string;
  upsert: boolean;
}) {
  const { bucket, path, fileBody, contentType, upsert } = params;
  const uploadPromise = supabase.storage.from(bucket).upload(path, fileBody, {
    contentType,
    upsert,
  });
  const { error: uploadErr } = await withTimeout(uploadPromise, 900_000, "Web storage upload");
  if (uploadErr) {
    throw new Error(`Upload failed: ${uploadErr.message}`);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data?.publicUrl ?? null, storagePath: path };
}

async function readFileAsBytes(localUri: string) {
  const { preparedUri, cleanupUri } = await prepareUploadUri(localUri);

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
  const { bucket, path, localUri, fileBody, upsert = true } = params;
  const contentType = normalizeContentType(params.contentType || localUri || path);

  try {
    const { data: sess, error: sessErr } = await withTimeout(supabase.auth.getSession(), 15_000, "Auth session check");
    if (sessErr) throw new Error(`Authentication failed: ${sessErr.message}`);
    if (!sess.session) throw new Error("No session. Please sign in again.");

    if (Platform.OS !== "web") {
      try {
        console.log("[uploadToSupabaseStorage] Native file upload -> start", { path, contentType });
        return await uploadViaNativeFileTransfer({
          bucket,
          path,
          localUri,
          contentType,
          accessToken: sess.session.access_token,
          upsert,
        });
      } catch (nativeErr) {
        console.log(
          "[uploadToSupabaseStorage] Native upload failed, falling back to byte upload",
          String((nativeErr as any)?.message || nativeErr),
        );
      }
    }

    if (Platform.OS === "web" && fileBody instanceof Blob) {
      console.log("[uploadToSupabaseStorage] Web blob upload -> start", {
        path,
        contentType,
        sizeBytes: (fileBody as any)?.size ?? null,
      });
      return await uploadViaWebBlob({
        bucket,
        path,
        fileBody,
        contentType,
        upsert,
      });
    }

    console.log("[uploadToSupabaseStorage] Reading file:", { path, contentType });
    const bytes = await readFileAsBytes(localUri);
    console.log("[uploadToSupabaseStorage] File read successfully:", { path, sizeBytes: bytes.length });

    const uploadPromise = supabase.storage.from(bucket).upload(path, bytes, {
      contentType,
      upsert,
    });

    console.log("[uploadToSupabaseStorage] Uploading to Supabase:", { bucket, path });
    const { error: uploadErr } = await withTimeout(uploadPromise, 900_000, "Storage upload");
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
