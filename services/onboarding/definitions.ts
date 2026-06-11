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
    title: "Market tour",
    summary: "Learn discovery, search, listing cards, and market filters.",
    steps: [
      {
        title: "Choose what you want to explore",
        body: "Use Products, Services, and Social Feed to switch between shopping, service discovery, and community updates.",
        targetId: "market.home.sections",
        targetLabel: "Section tabs",
        targetPosition: "top",
        actionLabel: "Tap Products, Services, or Social Feed and watch the feed change.",
        aiHint: "Explain the difference between the marketplace sections without overwhelming a first-time buyer.",
      },
      {
        title: "Find listings faster",
        body: "Search by name, category, or seller. Use the stock shortcut when you want to open the digital stock market instead.",
        targetId: "market.home.search",
        targetLabel: "Search and shortcuts",
        targetPosition: "top",
        actionLabel: "Tap Search to find a listing, or use the stock shortcut when you want digital stock tools.",
      },
      {
        title: "Refine the feed",
        body: "Use category chips, sorting, and location scope to narrow the market before opening a listing.",
        targetId: "market.home.filters",
        targetLabel: "Discovery controls",
        targetPosition: "middle",
        actionLabel: "Change one filter and confirm the listings below update.",
      },
      {
        title: "Open a listing",
        body: "Tap a card to review media, seller details, delivery terms, comments, and checkout options.",
        targetId: "market.home.cards",
        targetLabel: "Listing cards",
        targetPosition: "bottom",
        actionLabel: "Tap any card when you want the full listing page.",
      },
    ],
  },
  listingDetail: {
    key: "market_listing_detail",
    title: "Listing tour",
    summary: "Review media, seller trust, delivery terms, and buyer actions.",
    steps: [
      {
        title: "Review the offer",
        body: "Open images, videos, and previews so you understand what the seller is offering before checkout.",
        targetId: "market.listing.media",
        targetLabel: "Media preview",
        targetPosition: "top",
        actionLabel: "Tap the media area to inspect the listing preview.",
      },
      {
        title: "Check seller trust",
        body: "Review the store card, verification status, profile details, and message option before placing an order.",
        targetId: "market.listing.seller",
        targetLabel: "Seller trust card",
        targetPosition: "middle",
        actionLabel: "Scan the store name, verification state, and profile entry.",
      },
      {
        title: "Confirm order details",
        body: "Choose quantity, add delivery or service location details when needed, and check the total before continuing.",
        targetId: "market.listing.checkout",
        targetLabel: "Checkout controls",
        targetPosition: "bottom",
        actionLabel: "Set quantity or delivery details, then review the buy button total.",
      },
      {
        title: "Read community signals",
        body: "Reactions and comments help you understand buyer interest and ask questions before purchase.",
        targetId: "market.listing.community",
        targetLabel: "Community signals",
        targetPosition: "bottom",
        actionLabel: "Use reactions or comments when you need buyer/seller context.",
      },
    ],
  },
  stockHome: {
    key: "market_stock_home",
    title: "Digital stock tour",
    summary: "Browse stock identities, compare momentum, and open market tools.",
    steps: [
      {
        title: "Read the stock board",
        body: "Compare live stock identities by price, change, volume, and market cap before opening a market.",
        targetId: "stock.home.board",
        targetLabel: "Stock board",
        targetPosition: "middle",
        actionLabel: "Scan the stock cards and compare price, market cap, and activity.",
      },
      {
        title: "Search and sort markets",
        body: "Use search plus Trending, Most Traded, Largest Cap, and New to focus the list.",
        targetId: "stock.home.search",
        targetLabel: "Search and sort",
        targetPosition: "top",
        actionLabel: "Try a sort chip or search term to narrow the board.",
      },
      {
        title: "Use market shortcuts",
        body: "Create Stock and My Portfolio help you launch a store stock or manage your positions.",
        targetId: "stock.home.shortcuts",
        targetLabel: "Stock shortcuts",
        targetPosition: "top",
        actionLabel: "Use these shortcuts when you need to launch or manage positions.",
      },
      {
        title: "Open a market",
        body: "Use Open Market to view charts, trade, review recent fills, and join live discussion.",
        targetId: "stock.home.openMarket",
        targetLabel: "Open Market buttons",
        targetPosition: "bottom",
        actionLabel: "Tap Open Market when you are ready to inspect or trade a stock.",
      },
    ],
  },
  stockDetail: {
    key: "market_stock_detail",
    title: "Stock market tour",
    summary: "Read stats, switch panels, quote a trade, and review before submitting.",
    steps: [
      {
        title: "Read the market first",
        body: "Use stats and timeframes to understand price action, volume, and momentum before trading.",
        targetId: "stock.detail.stats",
        targetLabel: "Stats and timeframe",
        targetPosition: "top",
        actionLabel: "Change the timeframe and compare the stat cards.",
      },
      {
        title: "Choose the right panel",
        body: "Trade is where you buy or sell, Trades shows recent executions, and Chat is for market discussion.",
        targetId: "stock.detail.tabs",
        targetLabel: "Trade tabs",
        targetPosition: "middle",
        actionLabel: "Switch between Trade, Trades, and Chat to learn each panel.",
      },
      {
        title: "Get a quote",
        body: "Choose the active settlement rail, pick buy or sell, then enter an amount or quantity and wait for the quote.",
        targetId: "stock.detail.quote",
        targetLabel: "Quote panel",
        targetPosition: "bottom",
        actionLabel: "Enter a small amount and wait for the quote before submitting.",
      },
      {
        title: "Review before submitting",
        body: "Check the confirmation details before approval. Each supported rail shows the final settlement instructions.",
        targetId: "stock.detail.confirm",
        targetLabel: "Confirmation review",
        targetPosition: "bottom",
        actionLabel: "Tap buy or submit to open confirmation, then review it before approving.",
      },
    ],
  },
  stockPortfolio: {
    key: "market_stock_portfolio",
    title: "Portfolio tour",
    summary: "Track exposure, read each position, and reopen markets.",
    steps: [
      {
        title: "Track portfolio value",
        body: "The total value card summarizes your current market exposure in one place.",
        targetId: "stock.portfolio.total",
        targetLabel: "Portfolio total",
        targetPosition: "top",
        actionLabel: "Check this card first to understand your total exposure.",
      },
      {
        title: "Review each position",
        body: "Each row shows quantity, average cost, current price, unrealized profit or loss, and any locked shares.",
        targetId: "stock.portfolio.positions",
        targetLabel: "Position rows",
        targetPosition: "middle",
        actionLabel: "Open a position row when you need deeper detail.",
      },
      {
        title: "Return to a market",
        body: "Open a position whenever you want to trade again or inspect the full market screen.",
        targetId: "stock.portfolio.marketEntry",
        targetLabel: "Market entry",
        targetPosition: "bottom",
        actionLabel: "Tap a position to return to its market.",
      },
    ],
  },
  marketOrders: {
    key: "market_orders",
    title: "Orders tour",
    summary: "Filter buying and selling orders, narrow by stage, and open order details.",
    steps: [
      {
        title: "Switch order views",
        body: "Use All, Buying, and Selling to focus on orders where you are the buyer, seller, or both.",
        targetId: "market.orders.roleTabs",
        targetLabel: "Order role tabs",
        targetPosition: "top",
        actionLabel: "Tap Buying or Selling to narrow your orders.",
      },
      {
        title: "Filter by status",
        body: "Use Pending, Completed, Cancelled, and Disputed to find the order stage you need.",
        targetId: "market.orders.statusFilters",
        targetLabel: "Status filters",
        targetPosition: "top",
        actionLabel: "Tap a status to find orders in that stage.",
      },
      {
        title: "Follow pending stages",
        body: "When Pending is active, narrow further into Created, In Escrow, Out for Delivery, Uploaded, or Delivered.",
        targetId: "market.orders.pendingStages",
        targetLabel: "Pending stages",
        targetPosition: "middle",
        actionLabel: "Use pending stages to see what needs action next.",
      },
      {
        title: "Open order details",
        body: "Tap an order to review details and take the next available action.",
        targetId: "market.orders.cards",
        targetLabel: "Order cards",
        targetPosition: "bottom",
        actionLabel: "Tap an order card to continue that order workflow.",
      },
    ],
  },
  marketAccount: {
    key: "market_account",
    title: "Account hub tour",
    summary: "Use account tools, wallet access, and store readiness signals.",
    steps: [
      {
        title: "This is your account hub",
        body: "Your account hub brings together store setup, wallet access, orders, listings, history, verification, and the full market menu.",
        targetId: "market.account.header",
        targetLabel: "Market command center",
        targetPosition: "top",
        actionLabel: "Start here when you need account or store tools.",
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
        title: "Keep payment tools ready",
        body: "Use the wallet panel to open NGN funding, crypto wallet controls, and history before trading or selling.",
        targetId: "market.account.wallet",
        targetLabel: "Wallet access",
        targetPosition: "middle",
        actionLabel: "Open wallet controls before checkout or selling.",
      },
      {
        title: "Check readiness",
        body: "Account readiness shows what is active, what still needs attention, and where to go next.",
        targetId: "market.account.pulse",
        targetLabel: "Account pulse",
        targetPosition: "bottom",
        actionLabel: "Use readiness signals to fix anything blocking your account.",
      },
    ],
  },
  marketListings: {
    key: "market_listings",
    title: "Listings tour",
    summary: "Manage listings by category, status, ownership view, and search filters.",
    steps: [
      {
        title: "Find the right listing",
        body: "Use tabs, active status, sorting, and search to find the listing you need.",
        targetId: "market.listings.controls",
        targetLabel: "Listing controls",
        targetPosition: "top",
        actionLabel: "Use search or filters to find the listing you need.",
      },
      {
        title: "Manage your store listings",
        body: "On your own listing screen, review live status and manage each listing from its card.",
        targetId: "market.listings.cards",
        targetLabel: "Your listing cards",
        targetPosition: "middle",
        actionLabel: "Open a listing card to manage or inspect it.",
      },
      {
        title: "Browse another store",
        body: "When you open another store, this screen becomes a browsing feed for that store's published listings.",
        targetId: "market.listings.feed",
        targetLabel: "Seller store feed",
        targetPosition: "bottom",
        actionLabel: "Browse another store's cards like a storefront.",
      },
    ],
  },
  marketHistory: {
    key: "market_history",
    title: "History tour",
    summary: "Review balances, filter activity, and inspect individual records.",
    steps: [
      {
        title: "Start with the summary",
        body: "The summary shows filtered inflow, outflow, and net movement across your market activity.",
        targetId: "market.history.summary",
        targetLabel: "History summary",
        targetPosition: "top",
        actionLabel: "Read this first to understand the current filtered totals.",
      },
      {
        title: "Filter activity",
        body: "Use type, currency, search, and date filters to isolate deposits, buys, sells, profit, or a specific transaction.",
        targetId: "market.history.filters",
        targetLabel: "History filters",
        targetPosition: "middle",
        actionLabel: "Change one filter and watch the record list narrow.",
      },
      {
        title: "Open a record",
        body: "Tap a history row to inspect the full transaction entry, references, and attached identifiers.",
        targetId: "market.history.records",
        targetLabel: "History records",
        targetPosition: "bottom",
        actionLabel: "Tap a record when you need the full transaction details.",
      },
    ],
  },
} satisfies Record<string, TutorialFlowDefinition>;
