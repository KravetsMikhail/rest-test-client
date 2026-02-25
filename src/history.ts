import { config } from "./config";
import { encryptSensitive, decryptSensitive } from "./cipher";

export type AuthMode = "none" | "keycloak" | "headers";

export interface KeycloakAuth {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
}

export interface HistoryEntry {
  url: string;
  method: string;
  authMode?: AuthMode;
  keycloak?: KeycloakAuth;
  headers?: Record<string, string>;
  soapAction?: string;
  soapBody?: string;
}

const historyFile = "./data/history.json";
let items: HistoryEntry[] = [];

function normalize(entry: Partial<HistoryEntry>): HistoryEntry {
  const url = (entry.url ?? "").trim();
  const method = ((entry.method ?? "GET") as string).toUpperCase();
  const authMode = entry.authMode ?? "none";
  const keycloak = entry.keycloak && authMode === "keycloak" ? entry.keycloak : undefined;
  const headers = entry.headers && authMode === "headers" && Object.keys(entry.headers).length > 0 ? entry.headers : undefined;
  const soapAction = (entry.soapAction ?? "").trim() || undefined;
  const soapBody = (entry.soapBody ?? "").trim() || undefined;
  return {
    url,
    method,
    ...(authMode !== "none" && { authMode }),
    ...(keycloak && { keycloak }),
    ...(headers && { headers }),
    ...(soapAction && { soapAction }),
    ...(soapBody && { soapBody }),
  };
}

function decryptEntry(o: Record<string, unknown>): Partial<HistoryEntry> {
  const keycloak = o.keycloak as KeycloakAuth | undefined;
  let kOut: KeycloakAuth | undefined;
  if (keycloak && typeof keycloak === "object") {
    kOut = {
      serverUrl: String(keycloak.serverUrl ?? ""),
      realm: String(keycloak.realm ?? ""),
      clientId: String(keycloak.clientId ?? ""),
      clientSecret: keycloak.clientSecret != null ? decryptSensitive(String(keycloak.clientSecret)) : undefined,
      username: String(keycloak.username ?? ""),
      password: keycloak.password != null ? decryptSensitive(String(keycloak.password)) : "",
    };
  }
  let headers = o.headers as Record<string, string> | undefined;
  if (headers && typeof headers === "object") {
    const dec: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v !== "string") continue;
      dec[k] = k.toLowerCase() === "authorization" ? decryptSensitive(v) : v;
    }
    headers = dec;
  }
  return {
    url: String(o.url ?? ""),
    method: String(o.method ?? "GET"),
    authMode: o.authMode as AuthMode | undefined,
    keycloak: kOut,
    headers,
    soapAction: o.soapAction != null ? String(o.soapAction) : undefined,
    soapBody: o.soapBody != null ? String(o.soapBody) : undefined,
  };
}

async function load(): Promise<HistoryEntry[]> {
  try {
    const f = await Bun.file(historyFile).text();
    const parsed = JSON.parse(f);
    if (Array.isArray(parsed)) {
      items = parsed.map((x: unknown) => {
        if (typeof x === "object" && x !== null && "url" in (x as object)) {
          return normalize(decryptEntry(x as Record<string, unknown>));
        }
        return normalize({ url: String(x), method: "GET" });
      });
    } else {
      items = [];
    }
  } catch {
    items = [];
  }
  return items;
}

function encryptForSave(entry: HistoryEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    url: entry.url,
    method: entry.method,
    ...(entry.authMode && entry.authMode !== "none" && { authMode: entry.authMode }),
    ...(entry.soapAction && { soapAction: entry.soapAction }),
    ...(entry.soapBody && { soapBody: entry.soapBody }),
  };
  if (entry.keycloak) {
    out.keycloak = {
      serverUrl: entry.keycloak.serverUrl,
      realm: entry.keycloak.realm,
      clientId: entry.keycloak.clientId,
      clientSecret: entry.keycloak.clientSecret != null && entry.keycloak.clientSecret !== ""
        ? encryptSensitive(entry.keycloak.clientSecret)
        : entry.keycloak.clientSecret,
      username: entry.keycloak.username,
      password: entry.keycloak.password ? encryptSensitive(entry.keycloak.password) : "",
    };
  }
  if (entry.headers && Object.keys(entry.headers).length > 0) {
    const enc: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry.headers)) {
      enc[k] = k.toLowerCase() === "authorization" && v ? encryptSensitive(v) : v;
    }
    out.headers = enc;
  }
  return out;
}

async function save(): Promise<void> {
  const { mkdir } = await import("fs/promises");
  await mkdir("./data", { recursive: true });
  const toWrite = items.map(encryptForSave);
  await Bun.write(historyFile, JSON.stringify(toWrite, null, 2));
}

export async function getHistory(): Promise<HistoryEntry[]> {
  if (items.length === 0) await load();
  return [...items];
}

export interface AddHistoryAuth {
  authMode?: AuthMode;
  keycloak?: KeycloakAuth;
  headers?: Record<string, string>;
  soapAction?: string;
  soapBody?: string;
}

export async function addToHistory(url: string, method = "GET", auth?: AddHistoryAuth): Promise<HistoryEntry[]> {
  if (items.length === 0) await load();
  const entry = normalize({
    url,
    method,
    authMode: auth?.authMode,
    keycloak: auth?.keycloak,
    headers: auth?.headers,
    soapAction: auth?.soapAction,
    soapBody: auth?.soapBody,
  });
  if (!entry.url) return items;
  const key = (e: HistoryEntry) =>
    e.soapAction != null || e.soapBody != null ? `SOAP ${e.url} ${e.soapAction ?? ""}` : `${e.method} ${e.url}`;
  items = [entry, ...items.filter((e) => key(e) !== key(entry))].slice(
    0,
    config.historySize
  );
  await save();
  return [...items];
}
