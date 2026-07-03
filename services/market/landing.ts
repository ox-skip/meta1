import {
  fetchJsonWithTimeout,
  getSupabaseAnonKeyOrThrow,
  getSupabaseFunctionsBaseUrl,
} from "@/services/net";

export type LandingConfig = {
  brand_name: string;
  hero_eyebrow: string;
  hero_title: string;
  hero_subtitle: string;
  hero_media_url?: string | null;
  primary_cta_label: string;
  primary_cta_route: string;
  secondary_cta_label: string;
  secondary_cta_route: string;
  company_overview: string;
  mission_title: string;
  mission_body: string;
  vision_title: string;
  vision_body: string;
  what_building_title: string;
  what_building_body: string;
  why_building_title: string;
  why_building_body: string;
  blockchain_title: string;
  blockchain_body: string;
  product_title: string;
  product_body: string;
  stats_title: string;
  stats_subtitle: string;
  roadmap_title: string;
  roadmap_body: string;
  features_title: string;
  features_body: string;
  team_title: string;
  team_body: string;
  faq_title: string;
  faq_body: string;
  demo_title: string;
  demo_body: string;
  demo_cta_label: string;
  contact_title: string;
  contact_body: string;
  contact_email: string;
  contact_phone?: string | null;
  contact_address?: string | null;
  contact_cta_label: string;
  contact_cta_route: string;
};

export type LandingSection = {
  id: string;
  section_key: string;
  eyebrow?: string | null;
  title: string;
  body: string;
  media_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  sort_order: number;
};

export type LandingFeature = {
  id: string;
  title: string;
  body: string;
  icon_key: string;
  accent: string;
  sort_order: number;
};

export type LandingRoadmapItem = {
  id: string;
  title: string;
  body: string;
  status: "shipped" | "in_progress" | "planned" | "exploring";
  target_label?: string | null;
  sort_order: number;
};

export type LandingTeamMember = {
  id: string;
  name: string;
  role_title: string;
  bio?: string | null;
  image_url?: string | null;
  social_url?: string | null;
  sort_order: number;
};

export type LandingFaq = {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
};

export type LandingDemoVideo = {
  id: string;
  title: string;
  description?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  sort_order: number;
};

export type PublicLandingStats = Record<string, number | string | null>;

export type PublicLandingPayload = {
  ok: true;
  generated_at: string;
  stats: PublicLandingStats;
  content: {
    config: LandingConfig | null;
    sections: LandingSection[];
    features: LandingFeature[];
    roadmap: LandingRoadmapItem[];
    team_members: LandingTeamMember[];
    faqs: LandingFaq[];
    demo_videos: LandingDemoVideo[];
  };
};

export const FALLBACK_LANDING_CONFIG: LandingConfig = {
  brand_name: "BestCity Market",
  hero_eyebrow: "Trusted digital commerce for modern cities",
  hero_title: "BestCity Market",
  hero_subtitle:
    "A marketplace for verified sellers, escrow-protected orders, digital services, and blockchain-enabled store ownership.",
  hero_media_url: null,
  primary_cta_label: "Enter the market",
  primary_cta_route: "/market",
  secondary_cta_label: "Create account",
  secondary_cta_route: "/register",
  company_overview:
    "BestCity Market brings discovery, payments, escrow, seller verification, rewards, and store-backed stock identities into one commerce platform.",
  mission_title: "Our mission",
  mission_body: "Make online commerce safer, more transparent, and more rewarding for buyers, sellers, and communities.",
  vision_title: "Our vision",
  vision_body: "A trusted city-scale digital market where reputation, ownership, and settlement can move with users across borders.",
  what_building_title: "What we are building",
  what_building_body:
    "A premium marketplace stack with verified storefronts, escrow settlement, social commerce, rewards, support workflows, and optional blockchain rails for store stock.",
  why_building_title: "Why we are building it",
  why_building_body:
    "Small businesses need better trust tools, buyers need safer fulfillment, and digital markets need visible accountability from discovery through payout.",
  blockchain_title: "Why blockchain",
  blockchain_body:
    "Blockchain rails give BestCity Market transparent settlement records, programmable escrow, portable seller ownership, and auditable stock-market activity without replacing practical everyday commerce.",
  product_title: "Product details",
  product_body:
    "BestCity Market combines marketplace listings, social feeds, seller profiles, escrow checkout, dispute review, rewards, verification, and stock-identity tools in one connected experience.",
  stats_title: "Public platform statistics",
  stats_subtitle: "Live marketplace, escrow, transaction, verification, and stock-market signals refreshed from BestCity Market infrastructure.",
  roadmap_title: "Roadmap",
  roadmap_body: "The roadmap is managed by the BestCity Market team and updated as milestones ship.",
  features_title: "Platform features",
  features_body: "A trust-first commerce system built for repeat buying, accountable selling, and transparent settlement.",
  team_title: "Team",
  team_body: "The people building operations, trust, product, engineering, and growth for BestCity Market.",
  faq_title: "Frequently asked questions",
  faq_body: "Answers to common questions about BestCity Market, escrow, verification, demos, and support.",
  demo_title: "Product demo",
  demo_body: "Watch official BestCity Market demos hosted from this website. Admins can upload and publish new demo videos at any time.",
  demo_cta_label: "Open product demo",
  contact_title: "Contact BestCity Market",
  contact_body: "For partnerships, seller onboarding, support, or platform enquiries, contact the BestCity Market team.",
  contact_email: "support@bestcity.market",
  contact_phone: null,
  contact_address: null,
  contact_cta_label: "Contact support",
  contact_cta_route: "/market/support",
};

export async function fetchPublicLandingPayload() {
  const anon = getSupabaseAnonKeyOrThrow();
  const { res, json, text } = await fetchJsonWithTimeout(
    `${getSupabaseFunctionsBaseUrl()}/market-public-landing`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${anon}`,
        apikey: anon,
      },
    },
    20000,
  );

  if (!res.ok || !json || (json as any)?.error) {
    throw new Error(String((json as any)?.error || text || "Could not load BestCity Market."));
  }

  return json as PublicLandingPayload;
}

export function currentSiteDemoUrl() {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return origin ? `${origin}/demo#videos` : "/demo#videos";
}
