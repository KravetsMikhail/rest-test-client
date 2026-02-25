import { config } from "./config";
import { getHistory, addToHistory } from "./history";
import type { AuthMode, KeycloakAuth } from "./history";
import { isEncryptionEnabled } from "./cipher";
import { getKeycloakToken } from "./keycloak";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function handleExecute(req: Request): Promise<Response> {
  let body: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
    insecure?: boolean;
    soapAction?: string;
    soapBody?: string;
    graphqlQuery?: string;
    graphqlVariables?: string;
    graphqlOperationName?: string;
    keycloak?: {
      serverUrl: string;
      realm: string;
      clientId: string;
      clientSecret?: string;
      username: string;
      password: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { url: rawUrl, method, headers = {}, body: reqBody, bodyBase64, insecure, soapAction, soapBody, graphqlQuery, graphqlVariables, graphqlOperationName, keycloak } = body;
  if (!rawUrl || !method) {
    return json({ error: "url and method are required" }, 400);
  }

  const url = rawUrl.trim();
  if (!url) return json({ error: "url is required" }, 400);

  const headersRecord: Record<string, string> = { ...headers };

  if (keycloak) {
    try {
      const token = await getKeycloakToken({
        serverUrl: keycloak.serverUrl,
        realm: keycloak.realm,
        clientId: keycloak.clientId,
        clientSecret: keycloak.clientSecret,
        username: keycloak.username,
        password: keycloak.password,
      });
      headersRecord["Authorization"] = `Bearer ${token}`;
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : "Keycloak auth failed" },
        401
      );
    }
  }

  let requestBody: string | Uint8Array | undefined;
  if (bodyBase64 && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    try {
      requestBody = Buffer.from(bodyBase64, "base64");
    } catch {
      return json({ error: "Invalid bodyBase64" }, 400);
    }
  } else if (reqBody && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
    requestBody = reqBody;
  }

  try {
    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers: Object.keys(headersRecord).length ? headersRecord : undefined,
      body: requestBody,
      ...(insecure ? { tls: { rejectUnauthorized: false } } : {}),
    });

    const contentType = res.headers.get("content-type") ?? "";
    const isBinary = /^application\/(octet-stream|pdf|zip|x-)/.test(contentType) || (!contentType.includes("json") && !contentType.includes("text") && !contentType.includes("xml"));
    let responseBody: string;
    let responseBodyBase64: string | undefined;
    if (isBinary) {
      const buf = await res.arrayBuffer();
      responseBodyBase64 = Buffer.from(buf).toString("base64");
      responseBody = "";
    } else {
      responseBody = await res.text();
    }

    const authMode: AuthMode = keycloak ? "keycloak" : (Object.keys(headers).length > 0 ? "headers" : "none");
    await addToHistory(url, method.toUpperCase(), {
      authMode,
      keycloak: authMode === "keycloak" ? keycloak : undefined,
      headers: authMode === "headers" ? headers : undefined,
      soapAction: soapAction?.trim() || undefined,
      soapBody: soapBody?.trim() || undefined,
      graphqlQuery: graphqlQuery?.trim() || undefined,
      graphqlVariables: graphqlVariables?.trim() || undefined,
      graphqlOperationName: graphqlOperationName?.trim() || undefined,
    });

    return json({
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: responseBody,
      ...(responseBodyBase64 != null && { bodyBase64: responseBodyBase64 }),
      contentType,
    });
  } catch (err) {
    return json(
      {
        error: err instanceof Error ? err.message : "Request failed",
      },
      502
    );
  }
}

async function handleHistory(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method === "POST") {
    let body: { url?: string; method?: string; authMode?: AuthMode; keycloak?: unknown; headers?: Record<string, string>; soapAction?: string; soapBody?: string; graphqlQuery?: string; graphqlVariables?: string; graphqlOperationName?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const url = (body.url ?? "").trim();
    if (!url) return json({ error: "url is required" }, 400);
    const method = (body.method ?? "GET").toUpperCase();
    const authMode = (body.authMode ?? "none") as AuthMode;
    const list = await addToHistory(url, method, {
      authMode,
      keycloak: authMode === "keycloak" && body.keycloak && typeof body.keycloak === "object" ? (body.keycloak as KeycloakAuth) : undefined,
      headers: authMode === "headers" && body.headers && typeof body.headers === "object" ? body.headers : undefined,
      soapAction: body.soapAction?.trim() || undefined,
      soapBody: body.soapBody?.trim() || undefined,
      graphqlQuery: body.graphqlQuery?.trim() || undefined,
      graphqlVariables: body.graphqlVariables?.trim() || undefined,
      graphqlOperationName: body.graphqlOperationName?.trim() || undefined,
    });
    return json({ items: list });
  }
  const list = await getHistory();
  return json({ items: list });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const base = import.meta.dir + "/../frontend/dist";
  let path = pathname === "/" ? "/index.html" : pathname;
  if (!path.startsWith("/")) path = "/" + path;
  const file = Bun.file(base + path);
  if (await file.exists()) {
    const contentType =
      path.endsWith(".html") ? "text/html"
      : path.endsWith(".js") ? "application/javascript"
      : path.endsWith(".css") ? "text/css"
      : path.endsWith(".ico") ? "image/x-icon"
      : "application/octet-stream";
    return new Response(file, { headers: { "Content-Type": contentType } });
  }
  if (pathname !== "/" && !pathname.includes(".")) {
    const index = Bun.file(base + "/index.html");
    if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html" } });
  }
  return null;
}

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/execute" && req.method === "POST") {
      return handleExecute(req);
    }
    if (url.pathname === "/api/history") {
      return handleHistory(req);
    }
    if (url.pathname === "/api/config") {
      return json({ port: config.port, historySize: config.historySize, historyEncryption: isEncryptionEnabled() });
    }

    const staticRes = await serveStatic(url.pathname);
    if (staticRes) return staticRes;

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        "<!DOCTYPE html><html><body><h1>REST Test Client</h1><p>Соберите фронтенд: <code>bun run build</code>, затем обновите страницу.</p><p>API доступен: <a href=\"/api/history\">/api/history</a>, POST /api/execute</p></body></html>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    return new Response("Not Found", { status: 404, headers: CORS });
  },
});

console.log(`REST Test Client: http://localhost:${server.port}`);
