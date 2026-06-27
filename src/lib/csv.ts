// Parser/exportador CSV usando PapaParse.
import Papa from "papaparse";

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCSV(file: File): Promise<ParsedCSV> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        resolve({ headers: res.meta.fields ?? [], rows: res.data });
      },
      error: (err) => reject(err),
    });
  });
}

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function templateLeadsCSV(): string {
  return "telefone,nome,empresa,tags\n+5511912345678,Maria Silva,Acme,cliente;vip\n";
}