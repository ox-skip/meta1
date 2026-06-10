export type TutorialTargetPosition = "top" | "middle" | "bottom" | "left" | "right";

export type TutorialStep = {
  title: string;
  body: string;
  targetId?: string;
  targetLabel?: string;
  targetPosition?: TutorialTargetPosition;
  actionLabel?: string;
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
        targetId: "market.home.sections",
        targetLabel: "Section tabs",
        targetPosition: "top",
        actionLabel: "Tap Products, Services, or Social Feed and watch the feed change.",
        aiHint: "Explain the difference between the marketplace sections without overwhelming a first-time buyer.",
      },
      {
        title: "Search and open faster",
        body: "Use Search to jump to listings quickly, or open Digital Stock when you want tokenized stock trading instead of regular listings.",
        targetId: "market.home.search",
        targetLabel: "Search and shortcuts",
        targetPosition: "top",
        actionLabel: "Tap Search to find a listing, or use the stock shortcut when you want digital stock tools.",
      },
      {
        title: "Filter what you want",
        body: "Use the category chips, sort controls, and country or global scope to narrow the feed before opening a listing.",
        targetId: "market.home.filters",
        targetLabel: "Discovery controls",
        targetPosition: "middle",
        actionLabel: "Change one filter and confirm the listings below update.",
      },
      {
        title: "Open a card for full detail",
        body: "Tap a listing card to see previews, seller info, delivery rules, comments, and the escrow-protected checkout flow.",
        targetId: "market.home.cards",
        targetLabel: "Listing cards",
        targetPosition: "bottom",
        actionLabel: "Tap any card when you want the full listing page.",
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
        targetId: "market.listing.media",
        targetLabel: "Media preview",
        targetPosition: "top",
        actionLabel: "Tap the media area to inspect the listing preview.",
      },
      {
        title: "Review seller trust signals",
        body: "Check the seller card, verification badge, bio, and message entry point before placing an order.",
        targetId: "market.listing.seller",
        targetLabel: "Seller trust card",
        targetPosition: "middle",
        actionLabel: "Scan the seller name, verification state, and store/profile entry.",
      },
      {
        title: "Set quantity and delivery",
        body: "Choose the quantity, use your current location if delivery or service location matters, and confirm the final total shown on the buy button.",
        targetId: "market.listing.checkout",
        targetLabel: "Checkout controls",
        targetPosition: "bottom",
        actionLabel: "Set quantity or delivery details, then review the buy button total.",
      },
      {
        title: "Use reactions and comments",
        body: "Likes, dislikes, and comments help you read market sentiment and ask questions before purchase.",
        targetId: "market.listing.community",
        targetLabel: "Community signals",
        targetPosition: "bottom",
        actionLabel: "Use reactions or comments when you need buyer/seller context.",
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
        targetId: "stock.home.board",
        targetLabel: "Stock board",
        targetPosition: "middle",
        actionLabel: "Scan the stock cards and compare price, market cap, and activity.",
      },
      {
        title: "Search and sort",
        body: "Use search plus Trending, Most Traded, Largest Cap, and New to focus the list before opening a market.",
        targetId: "stock.home.search",
        targetLabel: "Search and sort",
        targetPosition: "top",
        actionLabel: "Try a sort chip or search term to narrow the board.",
      },
      {
        title: "Use the shortcuts",
        body: "Create EVM Stock and My Portfolio are the main entry points for launching or managing stock positions.",
        targetId: "stock.home.shortcuts",
        targetLabel: "Stock shortcuts",
        targetPosition: "top",
        actionLabel: "Use these shortcuts when you need to launch or manage positions.",
      },
      {
        title: "Open Market for execution",
        body: "Tap Open Market on a stock card to view charts, switch rails, trade, inspect fills, and join live chat.",
        targetId: "stock.home.openMarket",
        targetLabel: "Open Market buttons",
        targetPosition: "bottom",
        actionLabel: "Tap Open Market when you are ready to inspect or trade a stock.",
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
        targetId: "stock.detail.stats",
        targetLabel: "Stats and timeframe",
        targetPosition: "top",
        actionLabel: "Change the timeframe and compare the stat cards.",
      },
      {
        title: "Choose the correct panel",
        body: "Trade is where you buy or sell, Trades shows recent executions, and Chat is for market discussion.",
        targetId: "stock.detail.tabs",
        targetLabel: "Trade tabs",
        targetPosition: "middle",
        actionLabel: "Switch between Trade, Trades, and Chat to learn each panel.",
      },
      {
        title: "Pick rail, side, and quote",
        body: "Choose the available settlement rail, pick buy or sell, then enter amount or quantity and wait for the quote to update.",
        targetId: "stock.detail.quote",
        targetLabel: "Quote panel",
        targetPosition: "bottom",
        actionLabel: "Enter a small amount and wait for the quote before submitting.",
      },
      {
        title: "Confirm carefully",
        body: "Review the confirmation modal before submission. Each supported rail shows its own final settlement instructions before you commit.",
        targetId: "stock.detail.confirm",
        targetLabel: "Confirmation review",
        targetPosition: "bottom",
        actionLabel: "Tap buy or submit to open confirmation, then review it before approving.",
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
        targetId: "stock.portfolio.total",
        targetLabel: "Portfolio total",
        targetPosition: "top",
        actionLabel: "Check this card first to understand your total exposure.",
      },
      {
        title: "Read each position",
        body: "Every row shows quantity, average cost, current price, unrealized profit or loss, and any shares locked for redemption.",
        targetId: "stock.portfolio.positions",
        targetLabel: "Position rows",
        targetPosition: "middle",
        actionLabel: "Open a position row when you need deeper detail.",
      },
      {
        title: "Tap back into a market",
        body: "Open a position row whenever you want to trade that stock again or inspect its full market screen.",
        targetId: "stock.portfolio.marketEntry",
        targetLabel: "Market entry",
        targetPosition: "bottom",
        actionLabel: "Tap a position to return to its market.",
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
        targetId: "market.orders.roleTabs",
        targetLabel: "Order role tabs",
        targetPosition: "top",
        actionLabel: "Tap Buying or Selling to narrow your orders.",
      },
      {
        title: "Filter by status",
        body: "Use Pending, Completed, Cancelled, and Disputed to find the exact order stage you need.",
        targetId: "market.orders.statusFilters",
        targetLabel: "Status filters",
        targetPosition: "top",
        actionLabel: "Tap a status to find orders in that stage.",
      },
      {
        title: "Drill into pending stages",
        body: "When Pending is active you can narrow further into Created, In Escrow, Out for Delivery, Uploaded, or Delivered.",
        targetId: "market.orders.pendingStages",
        targetLabel: "Pending stages",
        targetPosition: "middle",
        actionLabel: "Use pending stages to see what needs action next.",
      },
      {
        title: "Open an order card",
        body: "Tap any order to review the order detail screen and take the next allowed action.",
        targetId: "market.orders.cards",
        targetLabel: "Order cards",
        targetPosition: "bottom",
        actionLabel: "Tap an order card to continue that order workflow.",
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
        targetId: "market.account.header",
        targetLabel: "Market command center",
        targetPosition: "top",
        actionLabel: "Start here when you need account or seller tools.",
      },
      {
        title: "Use the command tiles",
        body: "Open Edit Profile, Public Store, My Listings, Orders, History, Verification, and More Menu from the command grid.",
        targetId: "market.account.commands",
        targetLabel: "Command center",
        targetPosition: "middle",
        actionLabel: "Tap a command tile to jump directly to that tool.",
      },
      {
        title: "Keep the wallet ready",
        body: "Use the wallet panel to open NGN funding, crypto wallet controls, and history before trading or selling.",
        targetId: "market.account.wallet",
        targetLabel: "Wallet access",
        targetPosition: "middle",
        actionLabel: "Open wallet controls before checkout or selling.",
      },
      {
        title: "Read your account pulse",
        body: "The account pulse and readiness areas show what is active, what still needs attention, and where to go next.",
        targetId: "market.account.pulse",
        targetLabel: "Account pulse",
        targetPosition: "bottom",
        actionLabel: "Use readiness signals to fix anything blocking your account.",
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
        targetId: "market.listings.controls",
        targetLabel: "Listing controls",
        targetPosition: "top",
        actionLabel: "Use search or filters to find the listing you need.",
      },
      {
        title: "Your store view is operational",
        body: "When this is your own listing screen, you can review live status and manage listings directly from each card.",
        targetId: "market.listings.cards",
        targetLabel: "Your listing cards",
        targetPosition: "middle",
        actionLabel: "Open a listing card to manage or inspect it.",
      },
      {
        title: "Seller view is read-only",
        body: "When you open another seller's store, this screen becomes a browsing feed for their published listings.",
        targetId: "market.listings.feed",
        targetLabel: "Seller store feed",
        targetPosition: "bottom",
        actionLabel: "Browse another seller’s cards like a storefront.",
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
        targetId: "market.history.summary",
        targetLabel: "History summary",
        targetPosition: "top",
        actionLabel: "Read this first to understand the current filtered totals.",
      },
      {
        title: "Filter deeply",
        body: "Use kind, currency, search, and date parts to isolate deposits, buys, sells, profits, or a specific transaction.",
        targetId: "market.history.filters",
        targetLabel: "History filters",
        targetPosition: "middle",
        actionLabel: "Change one filter and watch the record list narrow.",
      },
      {
        title: "Open a record for detail",
        body: "Tap a history row to inspect the full transaction entry, references, and attached identifiers.",
        targetId: "market.history.records",
        targetLabel: "History records",
        targetPosition: "bottom",
        actionLabel: "Tap a record when you need the full transaction details.",
      },
    ],
  },
} satisfies Record<string, TutorialFlowDefinition>;
