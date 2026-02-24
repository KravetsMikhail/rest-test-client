import { useState, useEffect, useCallback, useRef } from "react";

type AuthMode = "none" | "keycloak" | "headers";

type LogLevel = "info" | "success" | "error" | "warn";

interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  details?: string;
}

const MAX_LOGS = 200;

function formatTime(): string {
  const d = new Date();
  return d.toLocaleTimeString("ru-RU", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

interface KeycloakConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

interface ExecuteResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsonToRows(data: unknown): { headers: string[]; rows: Record<string, unknown>[] } {
  const arr = Array.isArray(data) ? data : data && typeof data === "object" && "items" in (data as object) ? (data as { items: unknown[] }).items : Array.isArray(data) ? data : null;
  const list = Array.isArray(arr) ? arr : data && typeof data === "object" ? [data] : [];
  if (list.length === 0) return { headers: [], rows: [] };
  const headers = Array.from(
    new Set(
      list.flatMap((row) =>
        typeof row === "object" && row !== null ? Object.keys(row as object) : []
      )
    )
  );
  const rows = list.map((row) => {
    const r: Record<string, unknown> = {};
    headers.forEach((h) => (r[h] = typeof row === "object" && row !== null && h in (row as object) ? (row as Record<string, unknown>)[h] : ""));
    return r;
  });
  return { headers, rows };
}

export default function App() {
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "DELETE">("GET");
  const [body, setBody] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [keycloak, setKeycloak] = useState<KeycloakConfig>({
    serverUrl: "",
    realm: "",
    clientId: "",
    clientSecret: "",
    username: "",
    password: "",
  });
  const [headerRows, setHeaderRows] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responseView, setResponseView] = useState<"json" | "table">("json");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const requestStartRef = useRef<number>(0);

  const addLog = useCallback((level: LogLevel, message: string, details?: string) => {
    setLogs((prev) => [
      ...prev.slice(-(MAX_LOGS - 1)),
      { id: crypto.randomUUID(), time: formatTime(), level, message, details },
    ]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/history");
      const data = await r.json();
      setHistory(data.items ?? []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const addHeaderRow = () => setHeaderRows((prev) => [...prev, { key: "", value: "" }]);
  const removeHeaderRow = (i: number) =>
    setHeaderRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateHeaderRow = (i: number, field: "key" | "value", value: string) =>
    setHeaderRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const headersRecord = headerRows.reduce<Record<string, string>>((acc, { key, value }) => {
    const k = key.trim();
    if (k) acc[k] = value.trim();
    return acc;
  }, {});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);
    const targetUrl = url.trim();
    addLog("info", `Отправка запроса: ${method} ${targetUrl}`);
    if (authMode === "keycloak") {
      addLog("info", "Аутентификация через Keycloak…");
    }
    requestStartRef.current = performance.now();
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          method,
          headers: Object.keys(headersRecord).length ? headersRecord : undefined,
          body: body.trim() || undefined,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
        }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - requestStartRef.current);
      if (!res.ok) {
        const errMsg = data.error || `HTTP ${res.status}`;
        setError(errMsg);
        addLog("error", `Ошибка: ${errMsg}`, `Время: ${duration} мс`);
        return;
      }
      setResponse(data);
      const size = typeof data.body === "string" ? new Blob([data.body]).size : 0;
      addLog(
        "success",
        `Ответ ${data.status} ${data.statusText} за ${duration} мс`,
        `Размер тела: ${size} байт`
      );
    } catch (err) {
      const duration = Math.round(performance.now() - requestStartRef.current);
      const errMsg = err instanceof Error ? err.message : "Request failed";
      setError(errMsg);
      addLog("error", `Сбой запроса: ${errMsg}`, `Время до ошибки: ${duration} мс`);
    } finally {
      setLoading(false);
    }
  };

  const parsedBody = response?.contentType?.includes("json") ? parseJsonSafe(response.body) : null;
  const { headers: tableHeaders, rows: tableRows } = parsedBody != null ? jsonToRows(parsedBody) : { headers: [] as string[], rows: [] as Record<string, unknown>[] };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginBottom: 8, fontWeight: 600 }}>REST Test Client</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>URL, метод, тело запроса, Keycloak или заголовки</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>История (последние запросы)</label>
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) setUrl(v);
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
            }}
          >
            <option value="">— выбрать из истории —</option>
            {history.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "GET" | "POST" | "PUT" | "DELETE")}
            style={{
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              minWidth: 100,
            }}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="url"
            placeholder="https://api.example.com/path?param=value"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            style={{
              flex: 1,
              minWidth: 200,
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
            }}
          />
        </div>

        {["POST", "PUT"].includes(method) && (
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>Тело запроса (JSON)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder='{"key": "value"}'
              style={{
                width: "100%",
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                resize: "vertical",
              }}
            />
          </div>
        )}

        <div>
          <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>Аутентификация</label>
          <select
            value={authMode}
            onChange={(e) => setAuthMode(e.target.value as AuthMode)}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
            }}
          >
            <option value="none">Без аутентификации</option>
            <option value="keycloak">Keycloak</option>
            <option value="headers">Ручные заголовки</option>
          </select>
        </div>

        {authMode === "keycloak" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input placeholder="URL сервера Keycloak" value={keycloak.serverUrl} onChange={(e) => setKeycloak((k) => ({ ...k, serverUrl: e.target.value }))} style={inputStyle} />
            <input placeholder="Realm" value={keycloak.realm} onChange={(e) => setKeycloak((k) => ({ ...k, realm: e.target.value }))} style={inputStyle} />
            <input placeholder="Client ID" value={keycloak.clientId} onChange={(e) => setKeycloak((k) => ({ ...k, clientId: e.target.value }))} style={inputStyle} />
            <input placeholder="Client Secret (опционально)" value={keycloak.clientSecret} onChange={(e) => setKeycloak((k) => ({ ...k, clientSecret: e.target.value }))} style={inputStyle} />
            <input placeholder="Username" value={keycloak.username} onChange={(e) => setKeycloak((k) => ({ ...k, username: e.target.value }))} style={inputStyle} />
            <input type="password" placeholder="Password" value={keycloak.password} onChange={(e) => setKeycloak((k) => ({ ...k, password: e.target.value }))} style={inputStyle} />
          </div>
        )}

        {authMode === "headers" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--muted)" }}>Заголовки</span>
              <button type="button" onClick={addHeaderRow} style={btnSecondary}>+ Добавить</button>
            </div>
            {headerRows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input placeholder="Header" value={row.key} onChange={(e) => updateHeaderRow(i, "key", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <input placeholder="Value" value={row.value} onChange={(e) => updateHeaderRow(i, "value", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={() => removeHeaderRow(i)} style={btnSecondary}>×</button>
              </div>
            ))}
          </div>
        )}

        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? "Отправка…" : "Отправить"}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: 24, padding: 12, background: "rgba(239,68,68,0.15)", borderRadius: 8, color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: "var(--muted)", fontWeight: 600 }}>Логи</label>
          <button type="button" onClick={clearLogs} style={btnSecondary} disabled={logs.length === 0}>
            Очистить
          </button>
        </div>
        <div
          style={{
            padding: 12,
            background: "#0c0c0e",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "auto",
            maxHeight: 280,
            minHeight: 120,
            fontFamily: "var(--font)",
            fontSize: 13,
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>Здесь будут логи запросов: отправка, ответы, ошибки.</div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginBottom: 6,
                  padding: "4px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <span style={{ color: "var(--muted)", flexShrink: 0 }}>{entry.time}</span>
                <span
                  style={{
                    color:
                      entry.level === "error"
                        ? "var(--error)"
                        : entry.level === "success"
                          ? "var(--success)"
                          : entry.level === "warn"
                            ? "#eab308"
                            : "var(--text)",
                  }}
                >
                  {entry.message}
                </span>
                {entry.details && (
                  <span style={{ color: "var(--muted)", marginLeft: "auto" }}>{entry.details}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {response && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ color: "var(--muted)" }}>Ответ:</span>
            <span style={{ color: response.status >= 400 ? "var(--error)" : "var(--success)", fontWeight: 600 }}>
              {response.status} {response.statusText}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setResponseView("json")}
                style={{ ...btnSecondary, ...(responseView === "json" ? { background: "var(--accent-dim)", color: "white" } : {}) }}
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => setResponseView("table")}
                style={{ ...btnSecondary, ...(responseView === "table" ? { background: "var(--accent-dim)", color: "white" } : {}) }}
              >
                Таблица
              </button>
            </div>
          </div>
          <div
            style={{
              padding: 16,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "auto",
              maxHeight: 480,
            }}
          >
            {responseView === "json" && (
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {response.contentType?.includes("json")
                  ? (() => {
                      const parsed = parseJsonSafe(response.body);
                      return parsed != null ? JSON.stringify(parsed, null, 2) : response.body;
                    })()
                  : response.body}
              </pre>
            )}
            {responseView === "table" && (
              <>
                {tableHeaders.length > 0 ? (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {tableHeaders.map((h) => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((row, i) => (
                        <tr key={i}>
                          {tableHeaders.map((h) => (
                            <td key={h} style={tdStyle}>
                              {typeof row[h] === "object" && row[h] !== null
                                ? JSON.stringify(row[h])
                                : String(row[h] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <pre style={{ margin: 0 }}>{response.body || "—"}</pre>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
};

const btnPrimary: React.CSSProperties = {
  padding: "12px 24px",
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
};

const btnSecondary: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--surface)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "2px solid var(--border)",
  color: "var(--muted)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};
