import { Platform } from "react-native";

import { authenticateWithDevice, getLocalAuthInfo } from "@/utils/localAuth";

export type LocalAuthResult = {
  ok: boolean;
  code?: "no_hardware" | "not_enrolled" | "failed" | "cancelled";
  message?: string;
};

export async function requireLocalAuth(reason = "Confirm this action"): Promise<LocalAuthResult> {
  if (Platform.OS === "web") {
    // Web wallets already require explicit user approval for each action.
    return { ok: true };
  }

  try {
    const info = await getLocalAuthInfo();
    const hasHardware = info.hasHardware;
    if (!hasHardware) {
      return { ok: false, code: "no_hardware", message: "Biometric hardware is not available on this device." };
    }

    const enrolled = info.enrolled;
    if (!enrolled) {
      return { ok: false, code: "not_enrolled", message: "Biometrics are not set up. Please enroll Face ID / Fingerprint in settings." };
    }

    const res = await authenticateWithDevice(reason);

    if (res.success) return { ok: true };
    if (res.error === "user_cancel") return { ok: false, code: "cancelled", message: "Authentication cancelled." };
    return { ok: false, code: "failed", message: "Authentication failed." };
  } catch {
    return { ok: false, code: "failed", message: "Authentication failed." };
  }
}
