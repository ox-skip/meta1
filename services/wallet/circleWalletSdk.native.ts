type CircleApprovalInput = {
  userToken: string;
  encryptionKey: string;
  challengeId: string;
};

function circleAppId() {
  return String(process.env.EXPO_PUBLIC_CIRCLE_APP_ID || "").trim();
}

function circleSdkEndpoint() {
  return String(process.env.EXPO_PUBLIC_CIRCLE_SDK_ENDPOINT || "https://api.circle.com/v1/w3s").trim();
}

async function initWalletSdk() {
  const appId = circleAppId();
  if (!appId) {
    throw new Error("Circle wallet app id is missing. Set EXPO_PUBLIC_CIRCLE_APP_ID.");
  }

  const mod = require("@circle-fin/w3s-pw-react-native-sdk") as typeof import("@circle-fin/w3s-pw-react-native-sdk");
  await mod.WalletSdk.init({
    endpoint: circleSdkEndpoint(),
    appId,
    settingsManagement: { enableBiometricsPin: true },
  });
  return mod.WalletSdk;
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
  const sdk = await initWalletSdk();
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
      (error: any) => reject(new Error(String(error?.message || error || "Circle approval failed."))),
    );
  });
}
