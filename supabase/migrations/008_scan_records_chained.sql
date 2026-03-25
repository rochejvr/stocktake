-- Track whether a scan record was auto-credited from a chain
-- NULL = direct scan, barcode string = the code that was actually scanned to trigger this credit
ALTER TABLE scan_records ADD COLUMN chained_from text;
