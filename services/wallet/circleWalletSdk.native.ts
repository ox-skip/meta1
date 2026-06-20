type CircleApprovalInput = {
  userToken: string;
  encryptionKey: string;
  challengeId: string;
  env?: string | null;
};

function circleEnv(value?: string | null) {
  const env = String(value || "").trim().toLowerCase();
  return env === "testnet" || env === "mainnet" ? env : "";
}

function circleAppId(env?: string | null) {
  const normalized = circleEnv(env);
  const appId =
    normalized === "testnet"
      ? process.env.EXPO_PUBLIC_CIRCLE_TESTNET_APP_ID || process.env.EXPO_PUBLIC_CIRCLE_APP_ID
      : normalized === "mainnet"
        ? process.env.EXPO_PUBLIC_CIRCLE_MAINNET_APP_ID || process.env.EXPO_PUBLIC_CIRCLE_APP_ID
        : process.env.EXPO_PUBLIC_CIRCLE_APP_ID;
  return String(appId || "").trim();
}

function circleSdkEndpoint(env?: string | null) {
  const normalized = circleEnv(env);
  const endpoint =
    normalized === "testnet"
      ? process.env.EXPO_PUBLIC_CIRCLE_TESTNET_SDK_ENDPOINT || process.env.EXPO_PUBLIC_CIRCLE_SDK_ENDPOINT || "https://api.circle.com/v1/w3s"
      : normalized === "mainnet"
        ? process.env.EXPO_PUBLIC_CIRCLE_MAINNET_SDK_ENDPOINT || process.env.EXPO_PUBLIC_CIRCLE_SDK_ENDPOINT || "https://api.circle.com/v1/w3s"
        : process.env.EXPO_PUBLIC_CIRCLE_SDK_ENDPOINT || "https://api.circle.com/v1/w3s";
  return String(endpoint || "").trim();
}

async function initWalletSdk(env?: string | null) {
  const appId = circleAppId(env);
  if (!appId) {
    throw new Error("Circle wallet app id is missing. Set EXPO_PUBLIC_CIRCLE_APP_ID or the matching environment app id.");
  }

  const mod = require("@circle-fin/w3s-pw-react-native-sdk") as typeof import("@circle-fin/w3s-pw-react-native-sdk");
  
  // Retry initialization if it fails, as native module bridges can sometimes be busy
  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      await mod.WalletSdk.init({
        endpoint: circleSdkEndpoint(env),
        appId,
        settingsManagement: { enableBiometricsPin: true },
      });
      return mod.WalletSdk;
    } catch (e: any) {
      lastErr = e;
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error(`Circle Wallet SDK initialization failed: ${lastErr?.message || lastErr}`);
}

export async function getCircleDeviceId() {
  try {
    const sdk = await initWalletSdk();
    return String(sdk.deviceId || "");
  } catch {
    return "";
  }
}

export async function approveCircleChallenge(input: CircleApprovalInput) {
  const sdk = await initWalletSdk(input.env);
  const userToken = String(input.userToken || "").trim();
  const encryptionKey = String(input.encryptionKey || "").trim();
  const challengeId = String(input.challengeId || "").trim();

  if (!userToken || !encryptionKey || !challengeId) {
    throw new Error("Circle approval is missing required session data.");
  }

  return await new Promise<any>((resolve, reject) => {
    sdk.execute(
      userToken,
      encryptionKey,
      [challengeId],
      (result: any) => resolve(result),
      (error: any) => {
        const code = error?.code ? ` (code: ${error.code})` : "";
        const msg = String(error?.message || error || "Circle approval failed.");
        reject(new Error(`${msg}${code}`));
      },
    );
  });
}
