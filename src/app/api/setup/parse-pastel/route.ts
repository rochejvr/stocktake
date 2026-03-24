import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

interface ParsedRow {
  partNumber: string;
  description: string;
  qty: number;
  store: '001' | '002';
}

interface ParseResult {
  store001: ParsedRow[];
  store002: ParsedRow[];
  errors: string[];
}

function parseFile(buffer: Buffer, store: '001' | '002'): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { rows: [], errors: [`Failed to parse file for Store ${store}`] };
  }

  // Try each sheet until we find data
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    if (raw.length === 0) continue;

    for (const row of raw) {
      // Find columns by name (flexible — will adjust after seeing real files)
      const keys = Object.keys(row);
      const partKey = keys.find(k =>
        /item|part|code|stock/i.test(k)
      );
      const descKey = keys.find(k =>
        /desc|description|name/i.test(k)
      );
      const qtyKey = keys.find(k =>
        /qty|quantity|on.hand|balance|stock/i.test(k) && !/part|item|code/i.test(k)
      );

      if (!partKey) {
        errors.push(`Store ${store}: Could not identify part number column in sheet "${sheetName}"`);
        break;
      }

      const partNumber = String(row[partKey] || '').trim();
      if (!partNumber) continue;

      const description = descKey ? String(row[descKey] || '').trim() : '';
      const qty = qtyKey ? parseFloat(String(row[qtyKey]).replace(/[^0-9.-]/g, '')) || 0 : 0;

      rows.push({ partNumber, description, qty, store });
    }

    if (rows.length > 0) break; // Use first sheet with data
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
    const { rows, errors } = parseFile(buf, '001');
    result.store001 = rows;
    result.errors.push(...errors);
  }

  if (file002) {
    const buf = Buffer.from(await file002.arrayBuffer());
    const { rows, errors } = parseFile(buf, '002');
    result.store002 = rows;
    result.errors.push(...errors);
  }

  return NextResponse.json(result);
}
