# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Stock Take App — Agent Context

- **Stack**: Next.js 16.2.0 + React 19 + TypeScript 5 + Tailwind CSS 4 + Supabase
- **Port**: 3004
- **Dev**: `npm run dev` uses `--webpack` (not Turbopack — it hangs on `xlsx`). Fall back to `npm run build && npm start` if dev mode hangs.
- **No auth yet** — uses TEST_USER placeholder. Don't add auth middleware.
- **Barcode scanning**: ZXing-WASM engine, Code128 format. Key file: `src/components/scan/CameraScanner.tsx`
- **Types**: All interfaces in `src/types/index.ts`
- **Constants**: Tier thresholds and recount logic in `src/lib/constants.ts`

## UI Rules

- **Never use number input spinners/arrows** — hide with CSS (`appearance: textfield` + `::-webkit-inner-spin-button { display: none }`)
- Light theme, blue primary (`#2563eb`)
- Fonts: Outfit (headings), DM Sans (body), DM Mono (barcodes/part numbers)

## Status Flow

`setup → checklist → counting → recount ↔ reviewing → complete`

Do not create transitions outside this flow.
