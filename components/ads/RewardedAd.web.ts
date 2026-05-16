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

declare global {
  interface Window {
    googletag?: any;
    __bestcityGptEnabled?: boolean;
    __bestcityGptScriptPromise?: Promise<void>;
  }
}

const GPT_SCRIPT_URL = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
const DEV_REWARDED_WEB_UNIT = "/22639388115/rewarded_web_example";

function getWindow() {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return window;
}

function loadGooglePublisherTag() {
  const win = getWindow();
  if (!win) return Promise.reject(new Error("Rewarded web ads need a browser window."));

  win.googletag = win.googletag || { cmd: [] };
  if (win.googletag?.apiReady) return Promise.resolve();
  if (win.__bestcityGptScriptPromise) return win.__bestcityGptScriptPromise;

  win.__bestcityGptScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="securepubads.g.doubleclick.net/tag/js/gpt.js"], script[src*="googletagservices.com/tag/js/gpt.js"]',
    );
    if (existing) {
      window.setTimeout(resolve, 0);
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Publisher Tag failed to load.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = GPT_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Publisher Tag failed to load."));
    document.head.appendChild(script);
  });

  return win.__bestcityGptScriptPromise;
}

function shortTargetingValue(value?: string | null) {
  return String(value ?? "")
    .replace(/[^\w:.-]/g, "")
    .slice(0, 120);
}

export async function showRewardedAd(options: RewardedAdOptions = {}): Promise<RewardedAdResult> {
  const adUnitPath = options.adUnitId || (__DEV__ ? DEV_REWARDED_WEB_UNIT : null);
  if (!adUnitPath) {
    const message = "Google Ad Manager rewarded web ad unit path is missing.";
    options.onEvent?.("error", message);
    return { shown: false, earned: false, reward: null, error: message };
  }

  try {
    await loadGooglePublisherTag();
  } catch (error) {
    const message = String((error as any)?.message || error || "Google Publisher Tag failed to load.");
    options.onEvent?.("error", message);
    return { shown: false, earned: false, reward: null, error: message };
  }

  const win = getWindow();
  const googletag = win?.googletag;
  if (!win || !googletag?.cmd) {
    const message = "Google Publisher Tag is not available in this browser.";
    options.onEvent?.("error", message);
    return { shown: false, earned: false, reward: null, error: message };
  }

  return new Promise<RewardedAdResult>((resolve) => {
    let slot: any = null;
    let settled = false;
    let ready = false;
    let shown = false;
    let earned = false;
    let rewardPayload: RewardedAdResult["reward"] = null;
    let closeTimeout: ReturnType<typeof setTimeout> | null = null;

    const loadTimeout = setTimeout(() => {
      finish({
        shown,
        earned,
        reward: rewardPayload,
        error: ready ? null : "No rewarded web ad was available.",
      });
    }, 30000);

    const cleanup = () => {
      clearTimeout(loadTimeout);
      if (closeTimeout) clearTimeout(closeTimeout);
      if (slot && googletag.destroySlots) {
        try {
          googletag.destroySlots([slot]);
        } catch {
          // Best-effort cleanup only.
        }
      }
    };

    const finish = (result: RewardedAdResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result.error) options.onEvent?.("error", result.error);
      resolve(result);
    };

    googletag.cmd.push(() => {
      try {
        const rewardedFormat = googletag.enums?.OutOfPageFormat?.REWARDED;
        if (!rewardedFormat) {
          finish({
            shown: false,
            earned: false,
            reward: null,
            error: "This browser does not expose Google rewarded web ads.",
          });
          return;
        }

        slot = googletag.defineOutOfPageSlot(adUnitPath, rewardedFormat);
        if (!slot) {
          finish({
            shown: false,
            earned: false,
            reward: null,
            error: "Rewarded web ads require a mobile-optimized page and supported browser.",
          });
          return;
        }

        if (options.userId && slot.setTargeting) {
          slot.setTargeting("bestcity_user", shortTargetingValue(options.userId));
        }
        if (options.customData && slot.setTargeting) {
          slot.setTargeting("reward_session", shortTargetingValue(options.customData));
        }

        const pubads = googletag.pubads();
        slot.addService(pubads);

        pubads.addEventListener("rewardedSlotReady", (event: any) => {
          if (event.slot !== slot || settled) return;
          ready = true;
          clearTimeout(loadTimeout);
          options.onEvent?.("loaded");

          try {
            event.makeRewardedVisible();
            shown = true;
            options.onEvent?.("shown");
            closeTimeout = setTimeout(() => {
              finish({ shown, earned, reward: rewardPayload });
            }, 8 * 60 * 1000);
          } catch (error) {
            finish({
              shown: false,
              earned: false,
              reward: null,
              error: String((error as any)?.message || error || "Unable to show rewarded web ad."),
            });
          }
        });

        pubads.addEventListener("rewardedSlotGranted", (event: any) => {
          if (event.slot !== slot || settled) return;
          earned = true;
          rewardPayload = {
            type: String(event.payload?.type ?? "reward"),
            amount: Number(event.payload?.amount ?? 1),
          };
          options.onEvent?.("earned", rewardPayload);
        });

        pubads.addEventListener("rewardedSlotClosed", (event: any) => {
          if (event.slot !== slot || settled) return;
          options.onEvent?.("closed");
          finish({ shown, earned, reward: rewardPayload });
        });

        pubads.addEventListener("slotRenderEnded", (event: any) => {
          if (event.slot !== slot || settled || ready || !event.isEmpty) return;
          finish({
            shown: false,
            earned: false,
            reward: null,
            error: "No rewarded web ad fill was returned.",
          });
        });

        if (!win.__bestcityGptEnabled) {
          googletag.enableServices();
          win.__bestcityGptEnabled = true;
        }

        googletag.display(slot);
      } catch (error) {
        finish({
          shown: false,
          earned: false,
          reward: null,
          error: String((error as any)?.message || error || "Rewarded web ad failed."),
        });
      }
    });
  });
}
