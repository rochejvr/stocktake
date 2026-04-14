@AGENTS.md

# Stock Take — Xavant Technology

Quarterly stock take management app. Import Pastel inventory → department checklist sign-offs → mobile barcode scanning → variance reconciliation → Pastel adjustment export.

## Quick Start

```bash
npm run dev        # Dev server on port 3004 (uses --webpack, NOT Turbopack)
npm run build      # Production build
npm start          # Production server on port 3004
npm run lint       # ESLint
```

**Port**: 3004 (configured in package.json scripts, not next.config.ts)

**Dev mode note**: The dev script uses `--webpack` flag because Turbopack hangs when `xlsx` is imported. If dev mode still hangs, fall back to `npm run build && npm start`.

## Environment Variables

Required in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
```

Supabase is required — no demo/offline mode.

## Stack

- **Framework**: Next.js 16.2.0 + React 19 + TypeScript 5
- **Styling**: Tailwind CSS 4 (light theme, custom CSS vars in globals.css)
- **Database**: Supabase PostgreSQL
- **Barcode**: zxing-wasm (primary), html5-qrcode / quagga2 / native BarcodeDetector (diagnostic)
- **Icons**: lucide-react
- **Excel**: xlsx (Pastel CSV import/export)
- **Fonts**: Outfit (headings), DM Sans (body), DM Mono (barcodes/part numbers)

## Architecture

### Layout

Root layout (`layout.tsx`) wraps all pages in `AppShell` which provides:
- Collapsible sidebar with navigation and active stock take info
- Two-column layout (sidebar + content)
- Mobile `/scan` page is the exception — designed for phone screens

### Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard — status pipeline, stats, quick actions |
| `/setup` | Import Pastel CSV, create new stock take |
| `/checklist` | Department sign-offs (pre/during/post), observations |
| `/bom` | WIP → component BOM mappings, component chains |
| `/catalog` | Browse imported Pastel components |
| `/count` | Live scan feed from dashboard |
| `/scan` | Mobile counter interface — camera barcode scanning, PIN login |
| `/reconcile` | Variance review, accept/reject, reopen counting |
| `/export` | Generate Pastel adjustment journal CSV |

### API Routes (`src/app/api/`)

| Route | Purpose |
|-------|---------|
| `/api/stock-takes` | CRUD, `/active`, `/check`, `[id]/end-counting`, `[id]/export` |
| `/api/scan/lookup` | Validate barcode against Pastel inventory + BOM |
| `/api/scan-sessions` | Counter session CRUD, `[id]/submit`, `[id]/records` |
| `/api/scan-records` | Individual barcode scan records |
| `/api/count-results` | Aggregated counts, `[id]` accept/reject, `/recount-list` |
| `/api/counters` | Counter CRUD, `/login` (PIN auth) |
| `/api/bom/mappings` | WIP component mappings, `/wip/[wipCode]` |
| `/api/bom/chains` | Component chains (scan X → also credit Y) |
| `/api/bom/import` | Import BOM data |
| `/api/checklist` | Items, `/signoffs`, `/observations` |
| `/api/components` | Component catalog |
| `/api/setup/parse-pastel` | Parse uploaded Pastel inventory CSV |
| `/api/network-info` | LAN IP for mobile scanner QR code |

### Key Libraries (`src/lib/`)

- `supabase.ts` — Supabase client init
- `constants.ts` — Tier thresholds, recount logic, store/tier labels, deadlines

### Key Components (`src/components/`)

- `layout/AppShell.tsx` — Two-column layout container
- `layout/Sidebar.tsx` — Collapsible nav with active stock take info
- `scan/CameraScanner.tsx` — ZXing-WASM barcode scanner (primary)
- `scan/DiagnosticScanner.tsx` — Multi-engine comparison tool
- `shared/ScanQRCard.tsx` — QR code for mobile scanner URL
- `shared/ComponentSearch.tsx` — Searchable component selector
- `shared/StockTakeClock.tsx` — Countdown timer
- `bom/WipMasterList.tsx` — BOM hierarchy viewer
- `bom/WipDetailPanel.tsx` — Edit BOM components for a WIP
- `bom/BomStatsBar.tsx` — Missing/mapped component counts
- `bom/ComponentCompare.tsx` — Side-by-side BOM comparison
- `checklist/ObservationModal.tsx` — Issue logging (mini-CAPA)

## Database Tables (Supabase)

| Table | Purpose |
|-------|---------|
| `stock_takes` | Master record — status, deadlines, reference (ST-YYYY-QN) |
| `pastel_inventory` | Imported inventory with tier (A/B/C) and store (001/002) |
| `bom_mappings` | WIP code → component code with qty_per_wip |
| `component_chains` | Scan code X → also credit code Y |
| `component_catalog` | Active component descriptions |
| `counters` | Counter users with PIN |
| `scan_sessions` | Counter login sessions (user, count_number 1\|2, zone) |
| `scan_records` | Individual barcode scans with qty |
| `count_results` | Aggregated counts, variance, recount flags, acceptance |
| `checklist_items` | Pre/during/post sign-off tasks by department |
| `checklist_observations` | Issue logging with corrective/preventive actions |
| `checklist_signoffs` | Department sign-off records |

## Status Transitions

```
setup → checklist → counting → reviewing → complete
                        ↓            ↑
                     recount ────────┘
                        ↑            │
                        └── reviewing ┘  (reopen)
```

Valid transitions:
- `setup → checklist` — Pastel data imported
- `checklist → counting` — sign-offs complete
- `counting → reviewing` — end counting (Count 1)
- `counting → recount` — end counting with flagged items
- `recount → reviewing` — end recount (Count 2)
- `reviewing → recount` — reopen counting for more recounts
- `reviewing → complete` — all variances accepted/resolved

## Recount Logic

Defined in `src/lib/constants.ts`:

| Tier | Unit Cost | Variance Tolerance |
|------|-----------|-------------------|
| A | >= R500 | 0% (every unit must match) |
| B | >= R50 | 3% |
| C | < R50 | 5% |

Additional recount triggers:
- **Absolute ZAR threshold**: R500 variance regardless of percentage
- **Round number detection**: exact multiples of 50, 100, 200, 500, 1000
- **Zero count with Pastel balance**: counted 0 but Pastel shows stock
- **Significant change vs prior stock take**
- **Manual supervisor flag**

## Barcode Scanning

- **Engine**: ZXing-WASM (C++ → WebAssembly, fastest and most accurate)
- **Format**: Code128
- **Camera**: Requests 1920x1080, crops to center 75% width x 12% height (scan guide area)
- **Debounce**: 2000ms between same-barcode reads
- **Qty entry**: Custom numpad overlay (0-9 + backspace) — no native keyboard needed on mobile
- **Diagnostic mode**: Tests all 4 engines side-by-side with stats

## Pastel Export Format

**Critical** — Pastel silently fails on wrong format:
- 9 columns: Date, Code, Narration, Reference, Qty, Cost, GL, Projects, Store
- Date format: `DD/MM/YYYY`
- Narration: max 20 chars
- Reference: max 8 chars
- GL: 7-digit code
- Store: 3-char code (`001`, `002`)
- **No header row**
- **CRLF line endings** (`\r\n`) — Pastel on Windows ignores `\n`
- **Trailing comma** after last column

## Auth

**Not yet implemented.** Currently uses TEST_USER placeholder. PIN-based counter login exists for `/scan` page only. Future plan: role-based auth (admin, finance, production, procurement, readonly) matching invoice_eval middleware pattern.

## UI Rules

- **Never use number input spinners/arrows** — hide globally with CSS (`appearance: textfield` + `::-webkit-inner-spin-button { display: none }`)
- Light theme with blue primary (`#2563eb`)
- Custom CSS classes in globals.css for cards, buttons, badges, stat cards, tables
