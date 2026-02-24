import { config } from "./config";

const historyFile = "./data/history.json";
let items: string[] = [];

async function load(): Promise<string[]> {
  try {
    const f = await Bun.file(historyFile).text();
    items = JSON.parse(f);
  } catch {
    items = [];
  }
  return items;
}

async function save(): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir("./data", { recursive: true });
  await Bun.write(historyFile, JSON.stringify(items, null, 2));
}

export async function getHistory(): Promise<string[]> {
  if (items.length === 0) await load();
  return [...items];
}

export async function addToHistory(url: string): Promise<string[]> {
  if (items.length === 0) await load();
  const trimmed = url.trim();
  if (!trimmed) return items;
  items = [trimmed, ...items.filter((u) => u !== trimmed)].slice(
    0,
    config.historySize
  );
  await save();
  return [...items];
}
