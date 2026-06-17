type CircleApprovalInput = {
  userToken: string;
  encryptionKey: string;
  challengeId: string;
};

function circleAppId() {
  return String(process.env.EXPO_PUBLIC_CIRCLE_APP_ID || "").trim();
}

async function createSdk(userToken?: string, encryptionKey?: string) {
  const appId = circleAppId();
  if (!appId) {
    throw new Error("Circle wallet app id is missing. Set EXPO_PUBLIC_CIRCLE_APP_ID.");
  }

  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  const sdk = new mod.W3SSdk({ appSettings: { appId } });
  let deviceId = "";
  if (typeof (sdk as any).getDeviceId === "function") {
    deviceId = String(await Promise.resolve((sdk as any).getDeviceId()));
  }
  if (userToken && encryptionKey) {
    sdk.setAuthentication({ userToken, encryptionKey });
  }
  return { sdk, deviceId };
}

export async function getCircleDeviceId() {
  try {
    const { deviceId } = await createSdk();
    return deviceId;
  } catch {
    return "";
  }
}

export async function approveCircleChallenge(input: CircleApprovalInput) {
  const userToken = String(input.userToken || "").trim();
  const encryptionKey = String(input.encryptionKey || "").trim();
  const challengeId = String(input.challengeId || "").trim();
  if (!userToken || !encryptionKey || !challengeId) {
    throw new Error("Circle approval is missing required session data.");
  }

  const { sdk } = await createSdk(userToken, encryptionKey);

  return await new Promise<any>((resolve, reject) => {
    sdk.execute(challengeId, (error: any, result: any) => {
      if (error) {
        reject(new Error(String(error?.message || error || "Circle approval failed.")));
        return;
      }
      resolve(result);
    });
  });
}
