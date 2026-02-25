import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

type AuthMode = "none" | "keycloak" | "headers";

type LogLevel = "info" | "success" | "error" | "warn";

interface LogEntry {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  details?: string;
  kind?: "request_start" | "request_end";
}

const MAX_LOGS = 200;
const THEME_KEY = "rest-test-client-theme";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_KEY) as "light" | "dark" | null;
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

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
  bodyBase64?: string;
  contentType: string;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatXml(text: string): string {
  try {
    return text
      .replace(/>\s+</g, ">\n<")
      .replace(/\s*<\?[^?]+\?>\s*/g, (m) => m.trim() + "\n")
      .trim();
  } catch {
    return text;
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

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          type { kind name }
          args { name type { kind name } }
        }
        inputFields { name type { kind name } }
        enumValues(includeDeprecated: true) { name description }
      }
    }
  }
`.trim();

export default function App() {
  const { t, i18n } = useTranslation();
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
  const [historyEncryption, setHistoryEncryption] = useState(false);
  const [history, setHistory] = useState<{
    url: string;
    method: string;
    authMode?: AuthMode;
    keycloak?: KeycloakConfig;
    headers?: Record<string, string>;
    soapAction?: string;
    soapBody?: string;
    graphqlQuery?: string;
    graphqlVariables?: string;
    graphqlOperationName?: string;
  }[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responseView, setResponseView] = useState<"json" | "table">("json");
  const [insecureSSL, setInsecureSSL] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const [activeTab, setActiveTab] = useState<"rest" | "soap" | "graphql" | "files">("rest");
  const [soapUrl, setSoapUrl] = useState("");
  const [soapAction, setSoapAction] = useState("");
  const [soapBody, setSoapBody] = useState(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body></soap:Body>
</soap:Envelope>`);
  const [graphqlUrl, setGraphqlUrl] = useState("");
  const [graphqlQuery, setGraphqlQuery] = useState("query { __typename }");
  const [graphqlVariables, setGraphqlVariables] = useState("");
  const [graphqlOperationName, setGraphqlOperationName] = useState("");
  const [fileUploadUrl, setFileUploadUrl] = useState("");
  const [fileDownloadUrl, setFileDownloadUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileChunkSizeMb, setFileChunkSizeMb] = useState(5);
  const [filesLoading, setFilesLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const requestStartRef = useRef<number>(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const addLog = useCallback((level: LogLevel, message: string, details?: string) => {
    setLogs((prev) => [
      ...prev.slice(-(MAX_LOGS - 1)),
      { id: crypto.randomUUID(), time: formatTime(), level, message, details },
    ]);
  }, []);

  const addRequestBoundary = useCallback((kind: "request_start" | "request_end") => {
    setLogs((prev) => [
      ...prev.slice(-(MAX_LOGS - 1)),
      { id: crypto.randomUUID(), time: formatTime(), level: "info", message: "", kind },
    ]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const defaultKeycloak: KeycloakConfig = {
    serverUrl: "",
    realm: "",
    clientId: "",
    clientSecret: "",
    username: "",
    password: "",
  };

  const headersRecord = headerRows.reduce<Record<string, string>>((acc, { key, value }) => {
    const k = key.trim();
    if (k) acc[k] = value.trim();
    return acc;
  }, {});

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/history");
      const data = await r.json();
      const list = data.items ?? [];
      setHistory(
        Array.isArray(list)
          ? list.map((e: { url?: string; method?: string; authMode?: AuthMode; keycloak?: KeycloakConfig; headers?: Record<string, string>; soapAction?: string; soapBody?: string }) => ({
              url: e?.url ?? "",
              method: e?.method ?? "GET",
              authMode: e?.authMode,
              keycloak: e?.keycloak,
              headers: e?.headers,
              soapAction: e?.soapAction,
              soapBody: e?.soapBody,
              graphqlQuery: e?.graphqlQuery,
              graphqlVariables: e?.graphqlVariables,
              graphqlOperationName: e?.graphqlOperationName,
            }))
          : []
      );
    } catch {
      setHistory([]);
    }
  }, []);

  const saveToHistory = useCallback(async () => {
    const u = url.trim();
    if (!u) return;
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: u,
          method,
          authMode,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
          headers: authMode === "headers" && Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        }),
      });
      await loadHistory();
    } catch {
      // ignore
    }
  }, [url, method, authMode, keycloak, headersRecord, loadHistory]);

  const restHistory = history.filter((e) => !e.soapAction && !e.soapBody && !e.graphqlQuery);
  const soapHistory = history.filter((e) => e.soapAction != null || e.soapBody != null);
  const graphqlHistory = history.filter((e) => e.graphqlQuery != null);

  const saveToHistorySoap = useCallback(async () => {
    const u = soapUrl.trim();
    if (!u) return;
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: u,
          method: "POST",
          authMode,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
          headers: authMode === "headers" && Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
          soapAction: soapAction.trim() || undefined,
          soapBody: soapBody.trim() || undefined,
        }),
      });
      await loadHistory();
    } catch {
      // ignore
    }
  }, [soapUrl, soapAction, soapBody, authMode, keycloak, headersRecord, loadHistory]);

  const saveToHistoryGraphql = useCallback(async () => {
    const u = graphqlUrl.trim();
    if (!u) return;
    try {
      await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: u,
          method: "POST",
          authMode,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
          headers: authMode === "headers" && Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
          graphqlQuery: graphqlQuery.trim() || undefined,
          graphqlVariables: graphqlVariables.trim() || undefined,
          graphqlOperationName: graphqlOperationName.trim() || undefined,
        }),
      });
      await loadHistory();
    } catch {
      // ignore
    }
  }, [graphqlUrl, graphqlQuery, graphqlVariables, graphqlOperationName, authMode, keycloak, headersRecord, loadHistory]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setHistoryEncryption(d.historyEncryption === true))
      .catch(() => {});
  }, []);

  const addHeaderRow = () => setHeaderRows((prev) => [...prev, { key: "", value: "" }]);
  const removeHeaderRow = (i: number) =>
    setHeaderRows((prev) => prev.filter((_, idx) => idx !== i));
  const updateHeaderRow = (i: number, field: "key" | "value", value: string) =>
    setHeaderRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);
    const targetUrl = url.trim();
    addRequestBoundary("request_start");
    addLog("info", t("log.requestSend", { method, url: targetUrl }));
    if (authMode === "keycloak") {
      addLog("info", t("log.keycloakAuth"));
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
          insecure: insecureSSL,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
        }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - requestStartRef.current);
      if (!res.ok) {
        const errMsg = data.error || `HTTP ${res.status}`;
        setError(errMsg);
        addLog("error", t("log.error", { msg: errMsg }), t("log.errorTime", { duration }));
        return;
      }
      setResponse(data);
      const size = typeof data.body === "string" ? new Blob([data.body]).size : 0;
      const logLevel: LogLevel = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "success";
      addLog(
        logLevel,
        t("log.response", { status: data.status, statusText: data.statusText, duration }),
        t("log.bodySize", { size })
      );
    } catch (err) {
      const duration = Math.round(performance.now() - requestStartRef.current);
      const errMsg = err instanceof Error ? err.message : t("errors.requestFailed");
      setError(errMsg);
      addLog("error", t("log.fail", { msg: errMsg }), t("log.failTime", { duration }));
    } finally {
      addRequestBoundary("request_end");
      setLoading(false);
    }
  };

  const handleSoapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);
    const targetUrl = soapUrl.trim();
    if (!targetUrl) {
      setLoading(false);
      return;
    }
    addRequestBoundary("request_start");
    addLog("info", t("log.soapRequest", { url: targetUrl }));
    if (authMode === "keycloak") addLog("info", t("log.keycloakAuth"));
    requestStartRef.current = performance.now();
    const soapHeaders: Record<string, string> = {
      "Content-Type": "text/xml; charset=utf-8",
      ...headersRecord,
    };
    if (soapAction.trim()) soapHeaders["SOAPAction"] = soapAction.trim();
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          method: "POST",
          headers: soapHeaders,
          body: soapBody.trim() || undefined,
          insecure: insecureSSL,
          soapAction: soapAction.trim() || undefined,
          soapBody: soapBody.trim() || undefined,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
        }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - requestStartRef.current);
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        addLog("error", t("log.error", { msg: data.error || String(res.status) }), t("log.errorTime", { duration }));
        return;
      }
      setResponse(data);
      const logLevel: LogLevel = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "success";
      addLog(logLevel, t("log.response", { status: data.status, statusText: data.statusText, duration }), t("log.sizeBytes", { size: typeof data.body === "string" ? new Blob([data.body]).size : 0 }));
    } catch (err) {
      const duration = Math.round(performance.now() - requestStartRef.current);
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), t("log.errorTime", { duration }));
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setLoading(false);
    }
  };

  const handleGraphqlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);
    const targetUrl = graphqlUrl.trim();
    if (!targetUrl) {
      setLoading(false);
      return;
    }
    addRequestBoundary("request_start");
    addLog("info", t("log.graphqlRequest", { url: targetUrl }));
    if (authMode === "keycloak") addLog("info", t("log.keycloakAuth"));
    requestStartRef.current = performance.now();
    let variables: Record<string, unknown> = {};
    if (graphqlVariables.trim()) {
      const parsed = parseJsonSafe(graphqlVariables.trim());
      variables = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    }
    const gqlBody = JSON.stringify({
      query: graphqlQuery.trim(),
      ...(Object.keys(variables).length > 0 && { variables: variables }),
      ...(graphqlOperationName.trim() && { operationName: graphqlOperationName.trim() }),
    });
    const gqlHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headersRecord,
    };
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          method: "POST",
          headers: gqlHeaders,
          body: gqlBody,
          insecure: insecureSSL,
          graphqlQuery: graphqlQuery.trim() || undefined,
          graphqlVariables: graphqlVariables.trim() || undefined,
          graphqlOperationName: graphqlOperationName.trim() || undefined,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
        }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - requestStartRef.current);
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        addLog("error", t("log.error", { msg: data.error || String(res.status) }), t("log.errorTime", { duration }));
        return;
      }
      setResponse(data);
      const logLevel: LogLevel = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "success";
      addLog(logLevel, t("log.response", { status: data.status, statusText: data.statusText, duration }), t("log.sizeBytes", { size: typeof data.body === "string" ? new Blob([data.body]).size : 0 }));
    } catch (err) {
      const duration = Math.round(performance.now() - requestStartRef.current);
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), t("log.errorTime", { duration }));
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setLoading(false);
    }
  };

  const fetchSchema = useCallback(async () => {
    const targetUrl = graphqlUrl.trim();
    if (!targetUrl) return;
    setError(null);
    setResponse(null);
    setLoading(true);
    addRequestBoundary("request_start");
    addLog("info", t("log.schemaRequest", { url: targetUrl }));
    requestStartRef.current = performance.now();
    const gqlHeaders: Record<string, string> = { "Content-Type": "application/json", ...headersRecord };
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          method: "POST",
          headers: gqlHeaders,
          body: JSON.stringify({ query: INTROSPECTION_QUERY }),
          insecure: insecureSSL,
          keycloak: authMode === "keycloak" ? keycloak : undefined,
        }),
      });
      const data = await res.json();
      const duration = Math.round(performance.now() - requestStartRef.current);
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        addLog("error", t("log.schemaError", { msg: data.error || String(res.status) }), t("log.errorTime", { duration }));
        return;
      }
      setResponse(data);
      const logLevel: LogLevel = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "success";
      addLog(logLevel, t("log.schemaOk", { status: data.status, duration }), t("log.sizeBytes", { size: typeof data.body === "string" ? new Blob([data.body]).size : 0 }));
    } catch (err) {
      const duration = Math.round(performance.now() - requestStartRef.current);
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), t("log.errorTime", { duration }));
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setLoading(false);
    }
  }, [graphqlUrl, headersRecord, insecureSSL, authMode, keycloak, t]);

  const executeFileRequest = useCallback(async (payload: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
  }): Promise<ExecuteResponse> => {
    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: payload.url,
        method: payload.method,
        headers: payload.headers ?? headersRecord,
        body: payload.body,
        bodyBase64: payload.bodyBase64,
        insecure: insecureSSL,
        keycloak: authMode === "keycloak" ? keycloak : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [headersRecord, insecureSSL, authMode, keycloak]);

  const doFileDownload = useCallback(async () => {
    const targetUrl = fileDownloadUrl.trim();
    if (!targetUrl) return;
    setError(null);
    setFilesLoading(true);
    addRequestBoundary("request_start");
    addLog("info", t("log.fileDownload", { url: targetUrl }));
    const t0 = performance.now();
    try {
      const data = await executeFileRequest({ url: targetUrl, method: "GET" });
      addLog(data.status >= 400 ? "warn" : "success", t("log.responseShort", { status: data.status, duration: Math.round(performance.now() - t0) }), "");
      if (data.status < 200 || data.status >= 300) {
        setError(`HTTP ${data.status} ${data.statusText}`);
        return;
      }
      let blob: Blob;
      let filename = "";
      if (data.bodyBase64) {
        const bin = atob(data.bodyBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: data.contentType || "application/octet-stream" });
        const disp = data.headers["content-disposition"] || data.headers["Content-Disposition"];
        const m = disp && /filename\*?=(?:UTF-8'')?["']?([^"'\s;]+)["']?|filename=["']?([^"'\s;]+)["']?/i.exec(disp);
        if (m) filename = decodeURIComponent((m[1] || m[2] || "").replace(/^"(.*)"$/, "$1"));
        if (!filename) {
          const pathPart = targetUrl.replace(/#.*$/, "").split("?")[0];
          filename = pathPart.split("/").pop() || "download";
        }
      } else {
        blob = new Blob([data.body], { type: data.contentType || "application/octet-stream" });
        const pathPart = targetUrl.replace(/#.*$/, "").split("?")[0];
        filename = pathPart.split("/").pop() || "download";
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename || "download";
      a.click();
      URL.revokeObjectURL(a.href);
      addLog("info", t("log.fileSaved", { filename: filename || "download" }), "");
    } catch (err) {
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), "");
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setFilesLoading(false);
    }
  }, [fileDownloadUrl, executeFileRequest, t]);

  const doFileUploadSimple = useCallback(async () => {
    const targetUrl = fileUploadUrl.trim();
    if (!targetUrl || !selectedFile) return;
    setError(null);
    setFilesLoading(true);
    addRequestBoundary("request_start");
    addLog("info", t("log.fileUploadPut", { name: selectedFile.name }));
    const t0 = performance.now();
    try {
      const buf = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const bodyBase64 = btoa(b64);
      const headers: Record<string, string> = { ...headersRecord };
      if (!headers["Content-Type"]) headers["Content-Type"] = selectedFile.type || "application/octet-stream";
      await executeFileRequest({
        url: targetUrl,
        method: "PUT",
        headers,
        bodyBase64,
      });
      addLog("success", t("log.responseShort", { status: 200, duration: Math.round(performance.now() - t0) }), "");
    } catch (err) {
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), "");
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setFilesLoading(false);
    }
  }, [fileUploadUrl, selectedFile, headersRecord, executeFileRequest, t]);

  const doFileUploadMultipart = useCallback(async () => {
    const targetUrl = fileUploadUrl.trim();
    if (!targetUrl || !selectedFile) return;
    setError(null);
    setFilesLoading(true);
    addRequestBoundary("request_start");
    const t0 = performance.now();
    const chunkSizeBytes = Math.max(5, Math.min(100, fileChunkSizeMb)) * 1024 * 1024;
    const sep = targetUrl.includes("?") ? "&" : "?";
    try {
      addLog("info", t("log.multipartInit", { url: targetUrl + sep + "uploads" }));
      const initRes = await executeFileRequest({
        url: targetUrl + sep + "uploads",
        method: "POST",
        headers: { ...headersRecord },
      });
      const initBody = initRes.body || "";
      const parser = new DOMParser();
      const doc = parser.parseFromString(initBody, "text/xml");
      const uploadIdEl = doc.querySelector("UploadId");
      const uploadId = uploadIdEl?.textContent?.trim();
      if (!uploadId) {
        setError(t("errors.uploadIdMissing"));
        addLog("error", t("log.uploadIdNotFound"), initBody.slice(0, 500));
        return;
      }
      addLog("info", "UploadId: " + uploadId, "");
      const fileBuf = await selectedFile.arrayBuffer();
      const totalSize = fileBuf.byteLength;
      const partCount = Math.ceil(totalSize / chunkSizeBytes);
      const etags: { PartNumber: number; ETag: string }[] = [];
      for (let p = 1; p <= partCount; p++) {
        const start = (p - 1) * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, totalSize);
        const chunk = new Uint8Array(fileBuf, start, end - start);
        let b64 = "";
        const subChunk = 0x8000;
        for (let i = 0; i < chunk.length; i += subChunk) {
          b64 += String.fromCharCode.apply(null, chunk.subarray(i, i + subChunk));
        }
        const partUrl = targetUrl + sep + "uploadId=" + encodeURIComponent(uploadId) + "&partNumber=" + p;
        addLog("info", t("log.multipartPart", { p, total: partCount }), "");
        const partRes = await executeFileRequest({
          url: partUrl,
          method: "PUT",
          bodyBase64: btoa(b64),
          headers: { ...headersRecord, "Content-Type": selectedFile.type || "application/octet-stream" },
        });
        const etag = partRes.headers?.ETag ?? partRes.headers?.etag ?? "";
        etags.push({ PartNumber: p, ETag: etag });
      }
      const completeBody = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
${etags.map((e) => `  <Part><PartNumber>${e.PartNumber}</PartNumber><ETag>${e.ETag}</ETag></Part>`).join("\n")}
</CompleteMultipartUpload>`;
      addLog("info", t("log.multipartComplete"), "");
      await executeFileRequest({
        url: targetUrl + sep + "uploadId=" + encodeURIComponent(uploadId),
        method: "POST",
        headers: { ...headersRecord, "Content-Type": "application/xml" },
        body: completeBody,
      });
      addLog("success", t("log.multipartDone", { duration: Math.round(performance.now() - t0) }), "");
    } catch (err) {
      addLog("error", t("log.fail", { msg: err instanceof Error ? err.message : t("errors.requestFailed") }), "");
      setError(err instanceof Error ? err.message : t("errors.requestFailed"));
    } finally {
      addRequestBoundary("request_end");
      setFilesLoading(false);
    }
  }, [fileUploadUrl, selectedFile, fileChunkSizeMb, headersRecord, executeFileRequest, t]);

  const parsedBody = response?.contentType?.includes("json") ? parseJsonSafe(response.body) : null;
  const { headers: tableHeaders, rows: tableRows } = parsedBody != null ? jsonToRows(parsedBody) : { headers: [] as string[], rows: [] as Record<string, unknown>[] };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 4, fontWeight: 600 }}>{t("app.title")}</h1>
          <p style={{ color: "var(--muted)", margin: 0 }}>{t("app.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{t("theme.label")}</span>
          <button
            type="button"
            onClick={() => setTheme("light")}
            style={{
              ...btnSecondary,
              ...(theme === "light" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
            }}
          >
            {t("theme.light")}
          </button>
          <button
            type="button"
            onClick={() => setTheme("dark")}
            style={{
              ...btnSecondary,
              ...(theme === "dark" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
            }}
          >
            {t("theme.dark")}
          </button>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            style={{
              padding: "8px 12px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              fontSize: 13,
            }}
            aria-label={t("lang.label")}
          >
            <option value="ru">{t("lang.ru")}</option>
            <option value="en">{t("lang.en")}</option>
          </select>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setActiveTab("rest")}
          style={{
            ...btnSecondary,
            ...(activeTab === "rest" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
          }}
        >
          {t("tabs.rest")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("soap")}
          style={{
            ...btnSecondary,
            ...(activeTab === "soap" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
          }}
        >
          {t("tabs.soap")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("graphql")}
          style={{
            ...btnSecondary,
            ...(activeTab === "graphql" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
          }}
        >
          {t("tabs.graphql")}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("files")}
          style={{
            ...btnSecondary,
            ...(activeTab === "files" ? { background: "var(--accent-dim)", color: "white", borderColor: "var(--accent-dim)" } : {}),
          }}
        >
          {t("tabs.files")}
        </button>
      </div>

      {activeTab === "rest" && (
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("history.label")}</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                const i = parseInt(v, 10);
                const entry = restHistory[i];
                if (isNaN(i) || !entry) return;
                setUrl(entry.url);
                setMethod(entry.method as "GET" | "POST" | "PUT" | "DELETE");
                setAuthMode(entry.authMode ?? "none");
                if (entry.authMode === "keycloak" && entry.keycloak) {
                  setKeycloak({ ...defaultKeycloak, ...entry.keycloak });
                } else {
                  setKeycloak(defaultKeycloak);
                }
                if (entry.authMode === "headers" && entry.headers && Object.keys(entry.headers).length > 0) {
                  setHeaderRows(Object.entries(entry.headers).map(([key, value]) => ({ key, value })));
                } else {
                  setHeaderRows([{ key: "", value: "" }]);
                }
              }}
              style={{
                flex: 1,
                minWidth: 200,
                padding: "10px 12px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
              }}
            >
              <option value="">{t("history.selectPlaceholder")}</option>
              {restHistory.map((h, i) => {
                const authLabel = h.authMode === "keycloak" ? t("history.authKeycloak") : h.authMode === "headers" ? t("history.authHeaders") : "";
                return (
                  <option key={i} value={i}>{h.method} {h.url}{authLabel}</option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={saveToHistory}
              disabled={!url.trim()}
              style={btnSecondary}
              title={t("history.saveRestTitle")}
            >
              {t("history.save")}
            </button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
            {t("history.hint")}
            {historyEncryption && (
              <span style={{ display: "block", marginTop: 4 }}>{t("history.hintEncrypt")}</span>
            )}
          </p>
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
            placeholder={t("rest.urlPlaceholder")}
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
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("rest.bodyLabel")}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder={t("rest.bodyPlaceholder")}
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
          <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("auth.label")}</label>
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
            <option value="none">{t("auth.none")}</option>
            <option value="keycloak">{t("auth.keycloak")}</option>
            <option value="headers">{t("auth.headers")}</option>
          </select>
        </div>

        {authMode === "keycloak" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <input placeholder={t("auth.keycloakServerUrl")} value={keycloak.serverUrl} onChange={(e) => setKeycloak((k) => ({ ...k, serverUrl: e.target.value }))} style={inputStyle} />
            <input placeholder={t("auth.realm")} value={keycloak.realm} onChange={(e) => setKeycloak((k) => ({ ...k, realm: e.target.value }))} style={inputStyle} />
            <input placeholder={t("auth.clientId")} value={keycloak.clientId} onChange={(e) => setKeycloak((k) => ({ ...k, clientId: e.target.value }))} style={inputStyle} />
            <input placeholder={t("auth.clientSecret")} value={keycloak.clientSecret} onChange={(e) => setKeycloak((k) => ({ ...k, clientSecret: e.target.value }))} style={inputStyle} />
            <input placeholder={t("auth.username")} value={keycloak.username} onChange={(e) => setKeycloak((k) => ({ ...k, username: e.target.value }))} style={inputStyle} />
            <input type="password" placeholder={t("auth.password")} value={keycloak.password} onChange={(e) => setKeycloak((k) => ({ ...k, password: e.target.value }))} style={inputStyle} />
          </div>
        )}

        {authMode === "headers" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ color: "var(--muted)" }}>{t("headers.label")}</span>
              <button type="button" onClick={addHeaderRow} style={btnSecondary}>{t("headers.add")}</button>
            </div>
            {headerRows.map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input placeholder={t("headers.headerPlaceholder")} value={row.key} onChange={(e) => updateHeaderRow(i, "key", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <input placeholder={t("headers.valuePlaceholder")} value={row.value} onChange={(e) => updateHeaderRow(i, "value", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={() => removeHeaderRow(i)} style={btnSecondary}>×</button>
              </div>
            ))}
          </div>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={insecureSSL}
            onChange={(e) => setInsecureSSL(e.target.checked)}
          />
          <span style={{ color: "var(--muted)" }}>
            {t("ssl.insecure")}
          </span>
        </label>

        <button type="submit" disabled={loading} style={btnPrimary}>
          {loading ? t("submit.sending") : t("submit.send")}
        </button>
      </form>
      )}

      {activeTab === "soap" && (
        <form onSubmit={handleSoapSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("history.soapLabel")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") return;
                  const i = parseInt(v, 10);
                  const entry = soapHistory[i];
                  if (isNaN(i) || !entry) return;
                  setSoapUrl(entry.url);
                  setSoapAction(entry.soapAction ?? "");
                  if (entry.soapBody) setSoapBody(entry.soapBody);
                  setAuthMode(entry.authMode ?? "none");
                  if (entry.authMode === "keycloak" && entry.keycloak) {
                    setKeycloak({ ...defaultKeycloak, ...entry.keycloak });
                  } else {
                    setKeycloak(defaultKeycloak);
                  }
                  if (entry.authMode === "headers" && entry.headers && Object.keys(entry.headers).length > 0) {
                    setHeaderRows(Object.entries(entry.headers).map(([key, value]) => ({ key, value })));
                  } else {
                    setHeaderRows([{ key: "", value: "" }]);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "10px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                }}
              >
                <option value="">{t("history.selectPlaceholder")}</option>
                {soapHistory.map((h, i) => {
                  const label = h.soapAction ? `POST ${h.url} (${h.soapAction})` : `POST ${h.url}`;
                  return <option key={i} value={i}>{label}</option>;
                })}
              </select>
              <button
                type="button"
                onClick={saveToHistorySoap}
                disabled={!soapUrl.trim()}
                style={btnSecondary}
                title={t("history.saveSoapTitle")}
              >
                {t("history.save")}
              </button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {t("history.soapHint")}
            </p>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("soap.urlLabel")}</label>
            <input
              type="url"
              placeholder={t("soap.urlPlaceholder")}
              value={soapUrl}
              onChange={(e) => setSoapUrl(e.target.value)}
              required
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("soap.actionLabel")}</label>
            <input
              type="text"
              placeholder={t("soap.actionPlaceholder")}
              value={soapAction}
              onChange={(e) => setSoapAction(e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("soap.bodyLabel")}</label>
            <textarea
              value={soapBody}
              onChange={(e) => setSoapBody(e.target.value)}
              rows={14}
              placeholder={t("soap.bodyPlaceholder")}
              style={{
                width: "100%",
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontFamily: "var(--font)",
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>Аутентификация</label>
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as AuthMode)}
              style={{ ...inputStyle, width: "100%" }}
            >
              <option value="none">Без аутентификации</option>
              <option value="keycloak">Keycloak</option>
              <option value="headers">Ручные заголовки</option>
            </select>
          </div>
          {authMode === "keycloak" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input placeholder={t("auth.keycloakServerUrl")} value={keycloak.serverUrl} onChange={(e) => setKeycloak((k) => ({ ...k, serverUrl: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.realm")} value={keycloak.realm} onChange={(e) => setKeycloak((k) => ({ ...k, realm: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientId")} value={keycloak.clientId} onChange={(e) => setKeycloak((k) => ({ ...k, clientId: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientSecretShort")} value={keycloak.clientSecret} onChange={(e) => setKeycloak((k) => ({ ...k, clientSecret: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.username")} value={keycloak.username} onChange={(e) => setKeycloak((k) => ({ ...k, username: e.target.value }))} style={inputStyle} />
              <input type="password" placeholder={t("auth.password")} value={keycloak.password} onChange={(e) => setKeycloak((k) => ({ ...k, password: e.target.value }))} style={inputStyle} />
            </div>
          )}
          {authMode === "headers" && (
            <div>
              {headerRows.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input placeholder={t("headers.headerPlaceholder")} value={row.key} onChange={(e) => updateHeaderRow(i, "key", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input placeholder={t("headers.valuePlaceholder")} value={row.value} onChange={(e) => updateHeaderRow(i, "value", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => removeHeaderRow(i)} style={btnSecondary}>×</button>
                </div>
              ))}
              <button type="button" onClick={addHeaderRow} style={btnSecondary}>{t("headers.addRow")}</button>
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={insecureSSL} onChange={(e) => setInsecureSSL(e.target.checked)} />
            <span style={{ color: "var(--muted)" }}>{t("ssl.insecureShort")}</span>
          </label>
          <button type="submit" disabled={loading} style={btnPrimary}>
            {loading ? t("submit.sending") : t("submit.soap")}
          </button>
        </form>
      )}

      {activeTab === "graphql" && (
        <form onSubmit={handleGraphqlSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("history.graphqlLabel")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") return;
                  const i = parseInt(v, 10);
                  const entry = graphqlHistory[i];
                  if (isNaN(i) || !entry) return;
                  setGraphqlUrl(entry.url);
                  setGraphqlQuery(entry.graphqlQuery ?? "");
                  setGraphqlVariables(entry.graphqlVariables ?? "");
                  setGraphqlOperationName(entry.graphqlOperationName ?? "");
                  setAuthMode(entry.authMode ?? "none");
                  if (entry.authMode === "keycloak" && entry.keycloak) {
                    setKeycloak({ ...defaultKeycloak, ...entry.keycloak });
                  } else {
                    setKeycloak(defaultKeycloak);
                  }
                  if (entry.authMode === "headers" && entry.headers && Object.keys(entry.headers).length > 0) {
                    setHeaderRows(Object.entries(entry.headers).map(([key, value]) => ({ key, value })));
                  } else {
                    setHeaderRows([{ key: "", value: "" }]);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "10px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text)",
                }}
              >
                <option value="">{t("history.selectPlaceholder")}</option>
                {graphqlHistory.map((h, i) => (
                  <option key={i} value={i}>POST {h.url}{h.graphqlOperationName ? ` (${h.graphqlOperationName})` : ""}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveToHistoryGraphql}
                disabled={!graphqlUrl.trim()}
                style={btnSecondary}
                title={t("history.saveGraphqlTitle")}
              >
                {t("history.save")}
              </button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {t("history.graphqlHint")}
            </p>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("graphql.urlLabel")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="url"
                placeholder={t("graphql.urlPlaceholder")}
                value={graphqlUrl}
                onChange={(e) => setGraphqlUrl(e.target.value)}
                required
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
              />
              <button
                type="button"
                onClick={fetchSchema}
                disabled={!graphqlUrl.trim() || loading}
                style={btnSecondary}
                title={t("graphql.loadSchemaTitle")}
              >
                {t("graphql.loadSchema")}
              </button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--muted)" }}>
              {t("graphql.schemaHint")}
            </p>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("graphql.queryLabel")}</label>
            <textarea
              value={graphqlQuery}
              onChange={(e) => setGraphqlQuery(e.target.value)}
              rows={10}
              placeholder={t("graphql.queryPlaceholder")}
              style={{
                width: "100%",
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontFamily: "var(--font)",
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("graphql.variablesLabel")}</label>
            <textarea
              value={graphqlVariables}
              onChange={(e) => setGraphqlVariables(e.target.value)}
              rows={4}
              placeholder={t("graphql.variablesPlaceholder")}
              style={{
                width: "100%",
                padding: 12,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: "var(--text)",
                fontFamily: "var(--font)",
                fontSize: 13,
                resize: "vertical",
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("graphql.operationLabel")}</label>
            <input
              type="text"
              placeholder={t("graphql.operationPlaceholder")}
              value={graphqlOperationName}
              onChange={(e) => setGraphqlOperationName(e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("auth.label")}</label>
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as AuthMode)}
              style={{ ...inputStyle, width: "100%" }}
            >
              <option value="none">{t("auth.none")}</option>
              <option value="keycloak">{t("auth.keycloak")}</option>
              <option value="headers">{t("auth.headers")}</option>
            </select>
          </div>
          {authMode === "keycloak" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input placeholder={t("auth.keycloakServerUrl")} value={keycloak.serverUrl} onChange={(e) => setKeycloak((k) => ({ ...k, serverUrl: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.realm")} value={keycloak.realm} onChange={(e) => setKeycloak((k) => ({ ...k, realm: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientId")} value={keycloak.clientId} onChange={(e) => setKeycloak((k) => ({ ...k, clientId: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientSecretShort")} value={keycloak.clientSecret} onChange={(e) => setKeycloak((k) => ({ ...k, clientSecret: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.username")} value={keycloak.username} onChange={(e) => setKeycloak((k) => ({ ...k, username: e.target.value }))} style={inputStyle} />
              <input type="password" placeholder={t("auth.password")} value={keycloak.password} onChange={(e) => setKeycloak((k) => ({ ...k, password: e.target.value }))} style={inputStyle} />
            </div>
          )}
          {authMode === "headers" && (
            <div>
              {headerRows.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input placeholder={t("headers.headerPlaceholder")} value={row.key} onChange={(e) => updateHeaderRow(i, "key", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input placeholder={t("headers.valuePlaceholder")} value={row.value} onChange={(e) => updateHeaderRow(i, "value", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => removeHeaderRow(i)} style={btnSecondary}>×</button>
                </div>
              ))}
              <button type="button" onClick={addHeaderRow} style={btnSecondary}>{t("headers.addRow")}</button>
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={insecureSSL} onChange={(e) => setInsecureSSL(e.target.checked)} />
            <span style={{ color: "var(--muted)" }}>{t("ssl.insecureShort")}</span>
          </label>
          <button type="submit" disabled={loading} style={btnPrimary}>
            {loading ? t("submit.sending") : t("submit.graphql")}
          </button>
        </form>
      )}

      {activeTab === "files" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            {t("files.intro")}
          </p>
          <div>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)" }}>{t("auth.label")}</label>
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as AuthMode)}
              style={{ ...inputStyle, width: "100%" }}
            >
              <option value="none">{t("auth.none")}</option>
              <option value="keycloak">{t("auth.keycloak")}</option>
              <option value="headers">{t("auth.headers")}</option>
            </select>
          </div>
          {authMode === "keycloak" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input placeholder={t("auth.keycloakServerUrl")} value={keycloak.serverUrl} onChange={(e) => setKeycloak((k) => ({ ...k, serverUrl: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.realm")} value={keycloak.realm} onChange={(e) => setKeycloak((k) => ({ ...k, realm: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientId")} value={keycloak.clientId} onChange={(e) => setKeycloak((k) => ({ ...k, clientId: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.clientSecretShort")} value={keycloak.clientSecret} onChange={(e) => setKeycloak((k) => ({ ...k, clientSecret: e.target.value }))} style={inputStyle} />
              <input placeholder={t("auth.username")} value={keycloak.username} onChange={(e) => setKeycloak((k) => ({ ...k, username: e.target.value }))} style={inputStyle} />
              <input type="password" placeholder={t("auth.password")} value={keycloak.password} onChange={(e) => setKeycloak((k) => ({ ...k, password: e.target.value }))} style={inputStyle} />
            </div>
          )}
          {authMode === "headers" && (
            <div>
              {headerRows.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input placeholder={t("headers.headerPlaceholder")} value={row.key} onChange={(e) => updateHeaderRow(i, "key", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input placeholder={t("headers.valuePlaceholder")} value={row.value} onChange={(e) => updateHeaderRow(i, "value", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <button type="button" onClick={() => removeHeaderRow(i)} style={btnSecondary}>×</button>
                </div>
              ))}
              <button type="button" onClick={addHeaderRow} style={btnSecondary}>{t("headers.addRow")}</button>
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={insecureSSL} onChange={(e) => setInsecureSSL(e.target.checked)} />
            <span style={{ color: "var(--muted)" }}>{t("ssl.insecureShort")}</span>
          </label>

          <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontWeight: 600 }}>{t("files.downloadLabel")}</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="url"
                placeholder={t("files.downloadUrlPlaceholder")}
                value={fileDownloadUrl}
                onChange={(e) => setFileDownloadUrl(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
              />
              <button
                type="button"
                onClick={doFileDownload}
                disabled={!fileDownloadUrl.trim() || filesLoading}
                style={btnPrimary}
              >
                {filesLoading ? t("files.downloading") : t("files.downloadBtn")}
              </button>
            </div>
          </div>

          <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <label style={{ display: "block", marginBottom: 6, color: "var(--muted)", fontWeight: 600 }}>{t("files.uploadLabel")}</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="url"
                  placeholder={t("files.uploadUrlPlaceholder")}
                  value={fileUploadUrl}
                  onChange={(e) => setFileUploadUrl(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  style={{ color: "var(--text)" }}
                />
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {selectedFile ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)` : t("files.fileNotSelected")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
                  {t("files.chunkSizeLabel")}
                  <input
                    type="number"
                    min={5}
                    max={100}
                    value={fileChunkSizeMb}
                    onChange={(e) => setFileChunkSizeMb(Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5)))}
                    style={{ ...inputStyle, width: 72 }}
                  />
                </label>
                <button
                  type="button"
                  onClick={doFileUploadSimple}
                  disabled={!fileUploadUrl.trim() || !selectedFile || filesLoading}
                  style={btnSecondary}
                  title={t("files.simpleUploadTitle")}
                >
                  {t("files.simpleUpload")}
                </button>
                <button
                  type="button"
                  onClick={doFileUploadMultipart}
                  disabled={!fileUploadUrl.trim() || !selectedFile || filesLoading}
                  style={btnSecondary}
                  title={t("files.multipartUploadTitle")}
                >
                  {t("files.multipartUpload")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 24, padding: 12, background: "rgba(239,68,68,0.15)", borderRadius: 8, color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <label style={{ color: "var(--muted)", fontWeight: 600 }}>{t("logs.label")}</label>
          <button type="button" onClick={clearLogs} style={btnSecondary} disabled={logs.length === 0}>
            {t("logs.clear")}
          </button>
        </div>
        <div
          style={{
            padding: 12,
            background: "var(--log-bg)",
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
            <div style={{ color: "var(--muted)" }}>{t("logs.empty")}</div>
          ) : (
            [...logs].reverse().map((entry) =>
              entry.kind === "request_start" ? (
                <div key={entry.id} style={{ marginTop: 8, marginBottom: 6 }}>
                  <div style={{ height: 1, background: "var(--border)", marginBottom: 6 }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
                    {t("logs.requestStart")}
                  </div>
                </div>
              ) : entry.kind === "request_end" ? (
                <div key={entry.id} style={{ marginTop: 6, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {t("logs.requestEnd")}
                  </div>
                  <div style={{ height: 1, background: "var(--border)" }} />
                </div>
              ) : (
                <div
                  key={entry.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    marginBottom: 6,
                    padding: "4px 0",
                    borderBottom: "1px solid var(--log-border)",
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
              )
            )
          )}
        </div>
      </div>

      {response && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ color: "var(--muted)" }}>{t("response.label")}</span>
            <span style={{ color: response.status >= 400 ? "var(--error)" : "var(--success)", fontWeight: 600 }}>
              {response.status} {response.statusText}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setResponseView("json")}
                style={{ ...btnSecondary, ...(responseView === "json" ? { background: "var(--accent-dim)", color: "white" } : {}) }}
              >
                {t("response.jsonTab")}
              </button>
              <button
                type="button"
                onClick={() => setResponseView("table")}
                style={{ ...btnSecondary, ...(responseView === "table" ? { background: "var(--accent-dim)", color: "white" } : {}) }}
              >
                {t("response.tableTab")}
              </button>
            </div>
          </div>
          {response.headers && Object.keys(response.headers).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("response.headersTitle")}</div>
              <div
                style={{
                  padding: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "auto",
                  maxHeight: 200,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, width: "40%" }}>{t("response.nameCol")}</th>
                      <th style={thStyle}>{t("response.valueCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(response.headers).map(([name, value]) => (
                      <tr key={name}>
                        <td style={{ ...tdStyle, color: "var(--muted)", verticalAlign: "top" }}>{name}</td>
                        <td style={{ ...tdStyle, wordBreak: "break-all" }}>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
                  : response.contentType?.includes("xml")
                    ? formatXml(response.body)
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
                ) : response.contentType?.includes("xml") ? (
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{formatXml(response.body)}</pre>
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
