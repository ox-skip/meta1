export type TutorialTargetPosition = "top" | "middle" | "bottom" | "left" | "right";

export type TutorialStep = {
  title: string;
  body: string;
  targetLabel?: string;
  targetPosition?: TutorialTargetPosition;
  aiHint?: string;
};

export type TutorialFlowDefinition = {
  key: string;
  title: string;
  summary?: string;
  steps: TutorialStep[];
};

export const tutorialFlows = {
  marketHome: {
    key: "market_home",
    title: "Marketplace walkthrough",
    summary: "Learn the home feed, discovery controls, listing cards, and scope filters.",
    steps: [
      {
        title: "Start with the market sections",
        body: "Use Products, Services, and Social Feed to switch the kind of content you are browsing.",
        targetLabel: "Section tabs",
        targetPosition: "top",
        aiHint: "Explain the difference between the marketplace sections without overwhelming a first-time buyer.",
      },
      {
        title: "Search and open faster",
        body: "Use Search to jump to listings quickly, or open Digital Stock when you want tokenized stock trading instead of regular listings.",
        targetLabel: "Search and shortcuts",
        targetPosition: "top",
      },
      {
        title: "Filter what you want",
        body: "Use the category chips, sort controls, and country or global scope to narrow the feed before opening a listing.",
        targetLabel: "Discovery controls",
        targetPosition: "middle",
      },
      {
        title: "Open a card for full detail",
        body: "Tap a listing card to see previews, seller info, delivery rules, comments, and the escrow-protected checkout flow.",
        targetLabel: "Listing cards",
        targetPosition: "bottom",
      },
    ],
  },
  listingDetail: {
    key: "market_listing_detail",
    title: "Listing walkthrough",
    summary: "Inspect media, seller trust, delivery options, and buyer actions on a listing.",
    steps: [
      {
        title: "Preview before buying",
        body: "Open gallery images and service previews to inspect what the seller is offering before you commit to an order.",
        targetLabel: "Media preview",
        targetPosition: "top",
      },
      {
        title: "Review seller trust signals",
        body: "Check the seller card, verification badge, bio, and message entry point before placing an order.",
        targetLabel: "Seller trust card",
        targetPosition: "middle",
      },
      {
        title: "Set quantity and delivery",
        body: "Choose the quantity, use your current location if delivery or service location matters, and confirm the final total shown on the buy button.",
        targetLabel: "Checkout controls",
        targetPosition: "bottom",
      },
      {
        title: "Use reactions and comments",
        body: "Likes, dislikes, and comments help you read market sentiment and ask questions before purchase.",
        targetLabel: "Community signals",
        targetPosition: "bottom",
      },
    ],
  },
  stockHome: {
    key: "market_stock_home",
    title: "Stock market walkthrough",
    summary: "Browse stock identities, compare momentum, and open stock markets or portfolio tools.",
    steps: [
      {
        title: "Browse the stock board",
        body: "This screen lists live stock identities with price, change, volume, and market cap so you can compare opportunities quickly.",
        targetLabel: "Stock board",
        targetPosition: "middle",
      },
      {
        title: "Search and sort",
        body: "Use search plus Trending, Most Traded, Largest Cap, and New to focus the list before opening a market.",
        targetLabel: "Search and sort",
        targetPosition: "top",
      },
      {
        title: "Use the shortcuts",
        body: "Create EVM Stock and My Portfolio are the main entry points for launching or managing stock positions.",
        targetLabel: "Stock shortcuts",
        targetPosition: "top",
      },
      {
        title: "Open Market for execution",
        body: "Tap Open Market on a stock card to view charts, switch rails, trade, inspect fills, and join live chat.",
        targetLabel: "Open Market buttons",
        targetPosition: "bottom",
      },
    ],
  },
  stockDetail: {
    key: "market_stock_detail",
    title: "Stock detail walkthrough",
    summary: "Read market stats, switch panels, quote a trade, and confirm before submitting.",
    steps: [
      {
        title: "Read the market first",
        body: "Use the stat cards and timeframe chips to understand price action, volume, and momentum before trading.",
        targetLabel: "Stats and timeframe",
        targetPosition: "top",
      },
      {
        title: "Choose the correct panel",
        body: "Trade is where you buy or sell, Trades shows recent executions, and Chat is for market discussion.",
        targetLabel: "Trade tabs",
        targetPosition: "middle",
      },
      {
        title: "Pick rail, side, and quote",
        body: "Choose the available settlement rail, pick buy or sell, then enter amount or quantity and wait for the quote to update.",
        targetLabel: "Quote panel",
        targetPosition: "bottom",
      },
      {
        title: "Confirm carefully",
        body: "Review the confirmation modal before submission. Each supported rail shows its own final settlement instructions before you commit.",
        targetLabel: "Confirmation review",
        targetPosition: "bottom",
      },
    ],
  },
  stockPortfolio: {
    key: "market_stock_portfolio",
    title: "Portfolio walkthrough",
    summary: "Understand total exposure, read each position, and reopen markets from your portfolio.",
    steps: [
      {
        title: "Track total exposure",
        body: "The total value card summarizes your current portfolio in one place.",
        targetLabel: "Portfolio total",
        targetPosition: "top",
      },
      {
        title: "Read each position",
        body: "Every row shows quantity, average cost, current price, unrealized profit or loss, and any shares locked for redemption.",
        targetLabel: "Position rows",
        targetPosition: "middle",
      },
      {
        title: "Tap back into a market",
        body: "Open a position row whenever you want to trade that stock again or inspect its full market screen.",
        targetLabel: "Market entry",
        targetPosition: "bottom",
      },
    ],
  },
  marketOrders: {
    key: "market_orders",
    title: "Orders walkthrough",
    summary: "Filter buying and selling orders, narrow by stage, and open order details.",
    steps: [
      {
        title: "Switch between buying and selling",
        body: "Use All, Buying, and Selling to focus on orders where you are the buyer, the seller, or both.",
        targetLabel: "Order role tabs",
        targetPosition: "top",
      },
      {
        title: "Filter by status",
        body: "Use Pending, Completed, Cancelled, and Disputed to find the exact order stage you need.",
        targetLabel: "Status filters",
        targetPosition: "top",
      },
      {
        title: "Drill into pending stages",
        body: "When Pending is active you can narrow further into Created, In Escrow, Out for Delivery, Uploaded, or Delivered.",
        targetLabel: "Pending stages",
        targetPosition: "middle",
      },
      {
        title: "Open an order card",
        body: "Tap any order to review the order detail screen and take the next allowed action.",
        targetLabel: "Order cards",
        targetPosition: "bottom",
      },
    ],
  },
  marketAccount: {
    key: "market_account",
    title: "Account command walkthrough",
    summary: "Use the account command center, pulse cards, wallet entry, and store readiness tools.",
    steps: [
      {
        title: "This is your control center",
        body: "Market command center brings together seller profile setup, wallet access, orders, listings, history, verification, and the expanded market menu.",
        targetLabel: "Market command center",
        targetPosition: "top",
      },
      {
        title: "Use the command tiles",
        body: "Open Edit Profile, Public Store, My Listings, Orders, History, Verification, and More Menu from the command grid.",
        targetLabel: "Command center",
        targetPosition: "middle",
      },
      {
        title: "Keep the wallet ready",
        body: "Use the wallet panel to open NGN funding, crypto wallet controls, and history before trading or selling.",
        targetLabel: "Wallet access",
        targetPosition: "middle",
      },
      {
        title: "Read your account pulse",
        body: "The account pulse and readiness areas show what is active, what still needs attention, and where to go next.",
        targetLabel: "Account pulse",
        targetPosition: "bottom",
      },
    ],
  },
  marketListings: {
    key: "market_listings",
    title: "Listings walkthrough",
    summary: "Manage listings by category, status, ownership view, and search filters.",
    steps: [
      {
        title: "Manage by category and status",
        body: "Use the listing tabs, active filter, sort mode, and search input to find the exact listing you want.",
        targetLabel: "Listing controls",
        targetPosition: "top",
      },
      {
        title: "Your store view is operational",
        body: "When this is your own listing screen, you can review live status and manage listings directly from each card.",
        targetLabel: "Your listing cards",
        targetPosition: "middle",
      },
      {
        title: "Seller view is read-only",
        body: "When you open another seller's store, this screen becomes a browsing feed for their published listings.",
        targetLabel: "Seller store feed",
        targetPosition: "bottom",
      },
    ],
  },
  marketHistory: {
    key: "market_history",
    title: "History walkthrough",
    summary: "Review balances, filter transactions deeply, and inspect individual records.",
    steps: [
      {
        title: "Start with the summary",
        body: "The top summary shows filtered inflow, outflow, and net movement across your market activity.",
        targetLabel: "History summary",
        targetPosition: "top",
      },
      {
        title: "Filter deeply",
        body: "Use kind, currency, search, and date parts to isolate deposits, buys, sells, profits, or a specific transaction.",
        targetLabel: "History filters",
        targetPosition: "middle",
      },
      {
        title: "Open a record for detail",
        body: "Tap a history row to inspect the full transaction entry, references, and attached identifiers.",
        targetLabel: "History records",
        targetPosition: "bottom",
      },
    ],
  },
} satisfies Record<string, TutorialFlowDefinition>;
