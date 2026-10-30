/**
 * Curated ledger templates. Every vendor and product is fictional.
 * Generation picks a template, then varies items, quantities, prices,
 * document types and error placement from the round seed.
 */

export type LineDocumentKind = "invoice" | "purchaseOrder" | "expenseReport";

export interface ItemSpec {
  vendor: string;
  description: string;
  /** Inclusive quantity range. Expense reports always use 1. */
  qty: readonly [number, number];
  /** Inclusive unit price range in whole currency units. */
  price: readonly [number, number];
  docs: readonly LineDocumentKind[];
  /** Expense report claim categories (expense items only). */
  claimParts?: readonly string[];
}

export interface LedgerTemplate {
  id: string;
  department: string;
  title: string;
  fileName: string;
  taxLabel: string;
  /** Rate as a decimal, e.g. 0.0825. Shown in the sheet label and the memo. */
  taxRate: number;
  items: readonly ItemSpec[];
}

export const TEMPLATES: readonly LedgerTemplate[] = [
  {
    id: "office-ap",
    department: "Office Operations",
    title: "Q4 Accounts Payable",
    fileName: "AP_Recon_Q4_FINAL_v3.grid",
    taxLabel: "Sales tax",
    taxRate: 0.0825,
    items: [
      { vendor: "Paperclip Partners", description: "Jumbo paper clips (box/1000)", qty: [6, 40], price: [6, 14], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Staplewise Supply", description: "Heavy-duty staplers", qty: [2, 12], price: [18, 45], docs: ["invoice"] },
      { vendor: "Lumen & Ledger", description: "Ergonomic desk lamps", qty: [2, 10], price: [39, 89], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Brightwater Roasters", description: "Coffee beans, 5 lb bag", qty: [4, 24], price: [38, 62], docs: ["invoice"] },
      { vendor: "Northgate Furnishings", description: "Task chairs", qty: [2, 8], price: [189, 349], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Inkwell Imaging", description: "Toner cartridges", qty: [3, 15], price: [72, 118], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Synergy Signage", description: "Motivational posters", qty: [6, 30], price: [12, 28], docs: ["invoice"] },
      { vendor: "CleanSlate Facilities", description: "Whiteboard markers (12-pack)", qty: [5, 30], price: [9, 19], docs: ["invoice"] },
      { vendor: "Quorum AV Rentals", description: "Conference speakerphones", qty: [1, 4], price: [229, 399], docs: ["purchaseOrder"] },
      { vendor: "Evergreen Plantscapes", description: "Office plant maintenance (visits)", qty: [4, 20], price: [15, 35], docs: ["invoice"] },
      { vendor: "Paperlane Stationers", description: "Copy paper, case of 10 reams", qty: [5, 25], price: [41, 58], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Fernhill Springs", description: "Water cooler refills", qty: [10, 40], price: [7, 12], docs: ["invoice"] },
      { vendor: "Keystone Access", description: "Badge readers", qty: [1, 4], price: [310, 480], docs: ["purchaseOrder"] },
      { vendor: "Polaris Cable Co.", description: "HDMI cables, 6 ft", qty: [10, 50], price: [8, 16], docs: ["invoice", "purchaseOrder"] },
      { vendor: "J. Whitfield (Facilities)", description: "Emergency stapler repair callout", qty: [1, 1], price: [140, 420], docs: ["expenseReport"], claimParts: ["Callout fee", "Parts", "Parking"] },
    ],
  },
  {
    id: "marketing-summit",
    department: "Marketing",
    title: "Q4 Brand Summit Costs",
    fileName: "Summit_Costs_Q4_v7_REAL.grid",
    taxLabel: "Service tax",
    taxRate: 0.06,
    items: [
      { vendor: "Harborview Venues", description: "Ballroom rental (hours)", qty: [4, 10], price: [280, 450], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Totemark Promotions", description: "Branded tote bags", qty: [100, 400], price: [3, 7], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Lanyard Logic", description: "Printed lanyards", qty: [100, 500], price: [1, 3], docs: ["invoice"] },
      { vendor: "Saffron & Sage Catering", description: "Lunch buffet (per head)", qty: [60, 220], price: [18, 34], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Lumenstage", description: "Stage lighting rental (days)", qty: [1, 3], price: [650, 1200], docs: ["purchaseOrder"] },
      { vendor: "Shutterline Studio", description: "Event photography (hours)", qty: [4, 10], price: [95, 180], docs: ["invoice"] },
      { vendor: "Pinnacle Speakers Bureau", description: "Keynote: 'Synergy at Scale'", qty: [1, 1], price: [2500, 6000], docs: ["purchaseOrder"] },
      { vendor: "Hydrate Swag Co.", description: "Logo water bottles", qty: [80, 300], price: [4, 9], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Banner Bros. Print", description: "Vinyl banners", qty: [4, 16], price: [45, 110], docs: ["invoice"] },
      { vendor: "Foldwise Printing", description: "Tri-fold brochures", qty: [200, 900], price: [1, 2], docs: ["invoice"] },
      { vendor: "Pixelwall Rentals", description: "LED wall rental (days)", qty: [1, 3], price: [900, 1800], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Metroline Shuttles", description: "Shuttle bus trips", qty: [4, 18], price: [120, 240], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Badgecraft", description: "Name badges with QR codes", qty: [100, 400], price: [1, 4], docs: ["invoice"] },
      { vendor: "Brew Cart Collective", description: "Espresso cart (hours)", qty: [3, 8], price: [85, 140], docs: ["invoice"] },
      { vendor: "R. Okafor (Brand)", description: "Venue walkthrough expenses", qty: [1, 1], price: [160, 520], docs: ["expenseReport"], claimParts: ["Rail fare", "Meals", "Hotel (1 night)"] },
    ],
  },
  {
    id: "it-hardware",
    department: "IT",
    title: "Q4 Hardware Procurement",
    fileName: "IT_Procurement_Q4_DRAFT_final.grid",
    taxLabel: "Sales tax",
    taxRate: 0.075,
    items: [
      { vendor: "Corvid Computing", description: "14-inch laptops", qty: [2, 12], price: [890, 1490], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Clearview Displays", description: "27-inch monitors", qty: [4, 20], price: [210, 380], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Dockyard Devices", description: "USB-C docking stations", qty: [4, 20], price: [120, 210], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Keyform", description: "Mechanical keyboards", qty: [5, 25], price: [65, 140], docs: ["invoice"] },
      { vendor: "Trackwell", description: "Wireless mice", qty: [5, 30], price: [22, 48], docs: ["invoice"] },
      { vendor: "Quietline Audio", description: "Noise-cancelling headsets", qty: [4, 20], price: [95, 220], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Seatcount Software", description: "Productivity suite licenses (seats)", qty: [10, 60], price: [12, 30], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Framewell Optics", description: "1080p webcams", qty: [4, 20], price: [45, 95], docs: ["invoice"] },
      { vendor: "Voltline", description: "65W USB-C chargers", qty: [5, 30], price: [29, 59], docs: ["invoice"] },
      { vendor: "Rackhaus", description: "Rack PDUs", qty: [1, 4], price: [340, 690], docs: ["purchaseOrder"] },
      { vendor: "Meshpoint Networks", description: "24-port network switches", qty: [1, 6], price: [420, 980], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Solidstate Supply", description: "2 TB SSDs", qty: [4, 24], price: [110, 190], docs: ["invoice"] },
      { vendor: "Privacy Pane", description: "Monitor privacy screens", qty: [4, 30], price: [28, 64], docs: ["invoice"] },
      { vendor: "Cableway", description: "Under-desk cable trays", qty: [6, 30], price: [18, 42], docs: ["invoice", "purchaseOrder"] },
      { vendor: "M. Lindqvist (IT)", description: "Data center visit expenses", qty: [1, 1], price: [180, 640], docs: ["expenseReport"], claimParts: ["Mileage", "Parking", "Meals"] },
    ],
  },
  {
    id: "sales-travel",
    department: "Sales",
    title: "Q4 Travel & Expenses",
    fileName: "TandE_Q4_reconcile_ME.grid",
    taxLabel: "Processing fee",
    taxRate: 0.025,
    items: [
      { vendor: "A. Brennan (Sales)", description: "Client dinner, Harbor Grill", qty: [1, 1], price: [180, 640], docs: ["expenseReport"], claimParts: ["Dinner", "Beverages", "Gratuity"] },
      { vendor: "T. Nakamura (Sales)", description: "Regional roadshow, Denver", qty: [1, 1], price: [420, 1350], docs: ["expenseReport"], claimParts: ["Airfare", "Hotel", "Meals", "Taxi"] },
      { vendor: "P. Alvarez (Sales)", description: "Prospect lunch, Copper Kettle", qty: [1, 1], price: [60, 240], docs: ["expenseReport"], claimParts: ["Lunch", "Gratuity"] },
      { vendor: "Skyway Air", description: "Economy fares (tickets)", qty: [2, 8], price: [189, 520], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Lodgewell Hotels", description: "Hotel nights, corporate rate", qty: [4, 20], price: [119, 239], docs: ["invoice"] },
      { vendor: "Metro Ride", description: "Airport transfers", qty: [4, 20], price: [32, 75], docs: ["invoice"] },
      { vendor: "Summit Expo Group", description: "Trade show passes", qty: [2, 10], price: [295, 795], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Roadwise Rentals", description: "Car rental days", qty: [2, 12], price: [45, 98], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Connectivity Plus", description: "In-flight Wi-Fi passes", qty: [4, 20], price: [8, 19], docs: ["invoice"] },
      { vendor: "Deckhand Print", description: "Pitch deck printing (copies)", qty: [20, 120], price: [3, 9], docs: ["invoice"] },
      { vendor: "Greenroom Meetings", description: "Meeting room hire (hours)", qty: [2, 10], price: [60, 140], docs: ["invoice", "purchaseOrder"] },
      { vendor: "Giftly Corporate", description: "Client gift baskets", qty: [5, 25], price: [35, 85], docs: ["purchaseOrder", "invoice"] },
      { vendor: "Railink", description: "Rail tickets", qty: [2, 12], price: [39, 129], docs: ["invoice"] },
      { vendor: "Parkright", description: "Airport parking days", qty: [3, 14], price: [18, 32], docs: ["invoice"] },
      { vendor: "S. Duarte (Sales)", description: "Customer site visit, Austin", qty: [1, 1], price: [260, 880], docs: ["expenseReport"], claimParts: ["Airfare", "Hotel", "Meals"] },
    ],
  },
];

export const REJECTED_EXPENSES: readonly { label: string; reason: string }[] = [
  { label: "Hotel minibar", reason: "not reimbursable" },
  { label: "Seat upgrade", reason: "above travel policy" },
  { label: "Spa treatment", reason: "personal expense" },
  { label: "Premium wine", reason: "exceeds alcohol limit" },
  { label: "Movie rental", reason: "personal expense" },
  { label: "Late checkout fee", reason: "not pre-approved" },
];
