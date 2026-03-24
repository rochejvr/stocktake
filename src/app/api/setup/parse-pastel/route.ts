import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

interface ParsedRow {
  partNumber: string;
  description: string;
  qty: number;
  store: '001' | '002';
  unitCost: number | null;
}

interface ParseResult {
  store001: ParsedRow[];
  store002: ParsedRow[];
  errors: string[];
}

/**
 * Parse a Pastel "Inventory Valuation" export.
 *
 * Format (as exported by Pastel Evolution / Sage):
 *   Row 0: Company name / title
 *   Row 1: "On Hand" column header (multi-level)
 *   Row 2: "Excluding" (continuation)
 *   Row 3: "Code | Description | Store | Group | Unit | Unposted | Cost | Value"
 *   Row 4+: Part data
 *     Column 0 (key = company name string): Part code   e.g. XM400-01A01-02
 *     __EMPTY  : Description
 *     __EMPTY_1: Store number (1 or 2)
 *     __EMPTY_4: Quantity on hand (excl. unposted)
 *     __EMPTY_5: Unit cost
 */
function parsePastelFile(buffer: Buffer, store: '001' | '002'): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { rows: [], errors: [`Store ${store}: Failed to parse file`] };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Use header:1 to get raw arrays (avoids column name collision)
  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });

  if (raw.length < 5) {
    return { rows: [], errors: [`Store ${store}: File too short — expected Pastel export format`] };
  }

  // Data starts at row 4 (0-indexed) — skip title, headers, "On Hand/Excluding/Unposted" rows
  // Columns (0-indexed): 0=PartCode, 1=Description, 2=Store, 3=Group, 4=Unit, 5=Qty, 6=UnitCost, 7=Value
  for (let i = 4; i < raw.length; i++) {
    const row = raw[i];
    const partCode = String(row[0] || '').trim();
    if (!partCode) continue;

    // Skip non-part rows (column headers, group headers, subtotals)
    if (partCode.toLowerCase() === 'code') continue;
    if (!partCode.match(/^[A-Z0-9]/)) continue;
    if (partCode.toLowerCase().startsWith('total')) continue;
    if (partCode.toLowerCase().startsWith('group')) continue;

    const description = String(row[1] || '').trim();
    const qty = parseFloat(String(row[5] || '0').replace(/[^0-9.-]/g, '')) || 0;
    const unitCost = parseFloat(String(row[6] || '').replace(/[^0-9.-]/g, '')) || null;

    rows.push({ partNumber: partCode, description, qty, store, unitCost });
  }

  if (rows.length === 0) {
    errors.push(`Store ${store}: No part data found — check file format`);
  }

  return { rows, errors };
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file001 = formData.get('file001') as File | null;
  const file002 = formData.get('file002') as File | null;

  const result: ParseResult = { store001: [], store002: [], errors: [] };

  if (file001) {
    const buf = Buffer.from(await file001.arrayBuffer());
    const { rows, errors } = parsePastelFile(buf, '001');
    result.store001 = rows;
    result.errors.push(...errors);
  }

  if (file002) {
    const buf = Buffer.from(await file002.arrayBuffer());
    const { rows, errors } = parsePastelFile(buf, '002');
    result.store002 = rows;
    result.errors.push(...errors);
  }

  return NextResponse.json(result);
}
