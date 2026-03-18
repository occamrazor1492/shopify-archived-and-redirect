export function buildCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) {
    return "\uFEFF";
  }

  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const lines = [
    headers.map((header) => escapeCsvValue(header)).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsvValue(row[header])).join(","),
    ),
  ];

  return `\uFEFF${lines.join("\n")}`;
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>): void {
  const content = buildCsv(rows);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function escapeCsvValue(value: unknown): string {
  const text = value == null ? "" : String(value);

  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}
