export type TutorialStep = {
  title: string;
  body: string;
};

export type TutorialFlowDefinition = {
  key: string;
  title: string;
  steps: TutorialStep[];
};

export const tutorialFlows = {
  marketHome: {
    key: "market_home",
    title: "Marketplace walkthrough",
    steps: [
      {
        title: "Start with the market sections",
        body: "Use Products, Services, and Social Feed to switch the kind of content you are browsing.",
      },
      {
        title: "Search and open faster",
        body: "Use Search to jump to listings quickly, or open Digital Stock when you want tokenized stock trading instead of regular listings.",
      },
      {
        title: "Filter what you want",
        body: "Use the category chips, sort controls, and country or global scope to narrow the feed before opening a listing.",
      },
      {
        title: "Open a card for full detail",
        body: "Tap a listing card to see previews, seller info, delivery rules, comments, and the escrow-protected checkout flow.",
      },
    ],
  },
  listingDetail: {
    key: "market_listing_detail",
    title: "Listing walkthrough",
    steps: [
      {
        title: "Preview before buying",
        body: "Open gallery images and service previews to inspect what the seller is offering before you commit to an order.",
      },
      {
        title: "Review seller trust signals",
        body: "Check the seller card, verification badge, bio, and message entry point before placing an order.",
      },
      {
        title: "Set quantity and delivery",
        body: "Choose the quantity, use your current location if delivery or service location matters, and confirm the final total shown on the buy button.",
      },
      {
        title: "Use reactions and comments",
        body: "Likes, dislikes, and comments help you read market sentiment and ask questions before purchase.",
      },
    ],
  },
  stockHome: {
    key: "market_stock_home",
    title: "Stock market walkthrough",
    steps: [
      {
        title: "Browse the stock board",
        body: "This screen lists live stock identities with price, change, volume, and market cap so you can compare opportunities quickly.",
      },
      {
        title: "Search and sort",
        body: "Use search plus Trending, Most Traded, Largest Cap, and New to focus the list before opening a market.",
      },
      {
        title: "Use the shortcuts",
        body: "Create EVM Stock and My Portfolio are the main entry points for launching or managing stock positions.",
      },
      {
        title: "Open Market for execution",
        body: "Tap Open Market on a stock card to view charts, switch rails, trade, inspect fills, and join live chat.",
      },
    ],
  },
  stockDetail: {
    key: "market_stock_detail",
    title: "Stock detail walkthrough",
    steps: [
      {
        title: "Read the market first",
        body: "Use the stat cards and timeframe chips to understand price action, volume, and momentum before trading.",
      },
      {
        title: "Choose the correct panel",
        body: "Trade is where you buy or sell, Trades shows recent executions, and Chat is for market discussion.",
      },
      {
        title: "Pick rail, side, and quote",
        body: "Switch between EVM and Pi when available, choose buy or sell, then enter amount or quantity and wait for the quote to update.",
      },
      {
        title: "Confirm carefully",
        body: "Review the confirmation modal before submission. EVM trades settle on-chain, while Pi trades use the Pi payment or redemption flow shown in the screen.",
      },
    ],
  },
  stockPortfolio: {
    key: "market_stock_portfolio",
    title: "Portfolio walkthrough",
    steps: [
      {
        title: "Track total exposure",
        body: "The total value card summarizes your current portfolio in one place.",
      },
      {
        title: "Read each position",
        body: "Every row shows quantity, average cost, current price, unrealized profit or loss, and any shares locked for redemption.",
      },
      {
        title: "Tap back into a market",
        body: "Open a position row whenever you want to trade that stock again or inspect its full market screen.",
      },
    ],
  },
  marketOrders: {
    key: "market_orders",
    title: "Orders walkthrough",
    steps: [
      {
        title: "Switch between buying and selling",
        body: "Use All, Buying, and Selling to focus on orders where you are the buyer, the seller, or both.",
      },
      {
        title: "Filter by status",
        body: "Use Pending, Completed, Cancelled, and Disputed to find the exact order stage you need.",
      },
      {
        title: "Drill into pending stages",
        body: "When Pending is active you can narrow further into Created, In Escrow, Out for Delivery, Uploaded, or Delivered.",
      },
      {
        title: "Open an order card",
        body: "Tap any order to review the order detail screen and take the next allowed action.",
      },
    ],
  },
  marketAccount: {
    key: "market_account",
    title: "Account hub walkthrough",
    steps: [
      {
        title: "This is your control center",
        body: "Account Hub brings together seller profile setup, wallet access, orders, listings, history, verification, and the extra market menu.",
      },
      {
        title: "Use the command tiles",
        body: "Open Edit Profile, Public Store, My Listings, Orders, History, Verification, and More Menu from the shortcut grid.",
      },
      {
        title: "Keep the wallet ready",
        body: "Use the wallet panel to open NGN funding, crypto wallet controls, and history before trading or selling.",
      },
      {
        title: "Check launch readiness",
        body: "The checklist helps you confirm whether your store, wallet, listings, and verification are ready for live operation.",
      },
    ],
  },
  marketListings: {
    key: "market_listings",
    title: "Listings walkthrough",
    steps: [
      {
        title: "Manage by category and status",
        body: "Use the listing tabs, active filter, sort mode, and search input to find the exact listing you want.",
      },
      {
        title: "Your store view is operational",
        body: "When this is your own listing screen, you can review live status and manage listings directly from each card.",
      },
      {
        title: "Seller view is read-only",
        body: "When you open another seller's store, this screen becomes a browsing feed for their published listings.",
      },
    ],
  },
  marketHistory: {
    key: "market_history",
    title: "History walkthrough",
    steps: [
      {
        title: "Start with the summary",
        body: "The top summary shows filtered inflow, outflow, and net movement across your market activity.",
      },
      {
        title: "Filter deeply",
        body: "Use kind, currency, search, and date parts to isolate deposits, buys, sells, profits, or a specific transaction.",
      },
      {
        title: "Open a record for detail",
        body: "Tap a history row to inspect the full transaction entry, references, and attached identifiers.",
      },
    ],
  },
} satisfies Record<string, TutorialFlowDefinition>;
