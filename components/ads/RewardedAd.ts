import { Platform } from "react-native";
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from "react-native-google-mobile-ads";

export type RewardedAdOptions = {
  adUnitId?: string | null;
  userId?: string | null;
  customData?: string | null;
  onEvent?: (event: "loaded" | "shown" | "earned" | "closed" | "error", payload?: any) => void;
};

export type RewardedAdResult = {
  shown: boolean;
  earned: boolean;
  reward?: { type: string; amount: number } | null;
  error?: string | null;
};

export async function showRewardedAd(options: RewardedAdOptions = {}): Promise<RewardedAdResult> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") {
    return { shown: false, earned: false, error: "Rewarded ads are native-only." };
  }

  const unitId = options.adUnitId || (__DEV__
    ? TestIds.REWARDED
    : "ca-app-pub-4533962949749202/1804000824");

  const rewarded = RewardedAd.createForAdRequest(unitId, {
    requestNonPersonalizedAdsOnly: true,
    serverSideVerificationOptions:
      options.userId && options.customData
        ? {
            userId: options.userId,
            customData: options.customData,
          }
        : undefined,
  });

  return new Promise<RewardedAdResult>((resolve) => {
    let finished = false;
    let showed = false;
    let earned = false;
    let rewardPayload: RewardedAdResult["reward"] = null;

    const unsubscribers: (() => void)[] = [];
    const cleanup = () => unsubscribers.forEach((u) => u());

    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        showed = true;
        options.onEvent?.("loaded");
        rewarded.show();
        options.onEvent?.("shown");
      }),
    );

    unsubscribers.push(
      rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
        earned = true;
        rewardPayload = {
          type: String(reward?.type ?? "reward"),
          amount: Number(reward?.amount ?? 0),
        };
        options.onEvent?.("earned", rewardPayload);
      }),
    );

    unsubscribers.push(
      rewarded.addAdEventListener(AdEventType.CLOSED, () => {
        if (finished) return;
        finished = true;
        cleanup();
        options.onEvent?.("closed");
        resolve({ shown: showed, earned, reward: rewardPayload });
      }),
    );

    unsubscribers.push(
      rewarded.addAdEventListener(AdEventType.ERROR, (err) => {
        console.log("Rewarded ad error:", err);
        if (finished) return;
        finished = true;
        cleanup();
        const message = String((err as any)?.message || err || "Rewarded ad failed");
        options.onEvent?.("error", message);
        resolve({ shown: showed, earned: false, reward: null, error: message });
      }),
    );

    rewarded.load();
  });
}
