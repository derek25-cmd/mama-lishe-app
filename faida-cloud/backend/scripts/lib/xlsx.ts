import ExcelJS from "exceljs";

// Reads a named worksheet into plain row objects keyed by the header row.
// Skips fully-blank rows (the "soma_kwanza" / notes sheets convention in
// these workbooks leaves gaps).
export async function readSheetRows<T>(filePath: string, sheetName: string): Promise<T[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error(`sheet "${sheetName}" not found in ${filePath}`);

  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((h) => String(h));

  const rows: T[] = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const values = (sheet.getRow(i).values as unknown[]).slice(1);
    if (values.every((v) => v === undefined || v === null)) continue;
    const row = {} as Record<string, unknown>;
    headers.forEach((header, idx) => {
      row[header] = values[idx];
    });
    rows.push(row as T);
  }
  return rows;
}
