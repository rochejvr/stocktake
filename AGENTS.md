# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Stock Take App — Agent Context (v0.5.1)

- **Stack**: Next.js 16.2.0 + React 19 + TypeScript 5 + Tailwind CSS 4 + Supabase
- **Port**: 3004
- **Dev**: `npm run dev` uses `--webpack` (not Turbopack — it hangs on `xlsx`). Fall back to `npm run build && npm start` if dev mode hangs.
- **No auth yet** — uses TEST_USER placeholder. Don't add auth middleware.
- **Barcode scanning**: ZXing-WASM engine, Code128 format. Case-insensitive lookup (`.ilike()`), canonical DB casing stored.
- **Types**: All interfaces in `src/types/index.ts`
- **Constants**: Tier thresholds, recount logic, `buildReference(year, month)` in `src/lib/constants.ts`

## Critical: Supabase 1000-Row Limit

ALL queries that may return >1000 rows MUST use `fetchAll()` from `src/lib/supabase.ts`.
Tables that exceed 1000: `bom_mappings` (1150+), `pastel_inventory` (2118+), `count_results` (2118+).

## Count 2 Scoping

End-counting in recount mode uses `flaggedKeys` filter. Items in scope: flagged + chain descendants + directly scanned. WIP explosion filtered to flagged components only. Out-of-scope items preserve count2 via split-batch upserts (`upsertsWithC2` vs `upsertsC1Only`).

**Channel-aware per-item latest-round**: No global round filter. Each contribution channel (direct, WIP, external) tracks its own max round independently — a WIP scan in round N+1 does NOT filter out direct scans from round N. Two-pass: compute `maxRoundDirect`/`maxRoundWip`/`maxRoundExternal`, then filter per-channel in `aggregateRecords`. Breakdown API applies same channel-aware logic.

## UI Rules

- **Never use number input spinners/arrows** — hide with CSS
- Light theme, blue primary (`#2563eb`)
- Fonts: Outfit (headings), DM Sans (body), DM Mono (barcodes/part numbers)
- **Reconcile page**: sticky header via bounded `max-h-[calc(100vh-360px)]` scroll container
- **Changelog modal**: update `Sidebar.tsx` version + changelog on every release

## Status Flow

`setup → checklist → counting → recount ↔ reviewing → complete`

Do not create transitions outside this flow.
