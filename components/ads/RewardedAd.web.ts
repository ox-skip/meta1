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

export async function showRewardedAd(): Promise<RewardedAdResult> {
  return {
    shown: false,
    earned: false,
    reward: null,
    error: "Rewarded video ads are not configured for web yet.",
  };
}
