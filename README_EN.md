# REST Test Client

[Русская версия](README.md)

[![Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun)](https://bun.sh/)
[![React](https://img.shields.io/badge/frontend-React%2018-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/build-Vite%205-646CFF?logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](https://www.docker.com/)

![REST Test Client UI](docs/rest_test_client_01.png)

A universal web client for testing APIs: **REST**, **SOAP**, **GraphQL**, and **file operations** (S3-compatible API). Includes a unified request history, authentication via **Keycloak** or custom headers, response rendering (JSON, table, XML), and optional encryption of sensitive history fields.

- **Stack**: Bun (server + API), React + Vite (frontend)
- **Default port**: 5335 (configurable via `PORT`)
- **History**: last 20 requests (configurable via `HISTORY_SIZE`), shared for REST/SOAP/GraphQL

## Requirements

- For local development/build: [Bun](https://bun.sh/) or Node.js 18+

## Install

```bash
bun install
cd frontend && bun install && cd ..
```

## Configuration

Copy `.env.example` to `.env` and adjust if needed:

- `PORT` — web UI port (default 5335)
- `HISTORY_SIZE` — how many last requests to keep in history (default 20)
- `HISTORY_ENCRYPTION_KEY` — (optional) encryption key for passwords/tokens in history (32 bytes base64 or 64 hex chars)

## Run

1. Build the frontend (once or after changes):

```bash
bun run build
```

2. Start the server:

```bash
bun start
```

Open in browser: **http://localhost:5335**

## Docker (recommended for production)

Build and run the app **only with Docker**: the frontend is built inside the image using Node 20; the host does not need a modern Node or Bun.

### Build image

```bash
docker build -t rest-test-client .
```

### Run container

Default port (5335):

```bash
docker run --rm -p 5335:5335 rest-test-client
```

Custom port and history settings:

```bash
docker run --rm \
  -e PORT=8080 \
  -e HISTORY_SIZE=50 \
  -p 8080:8080 \
  rest-test-client
```

Then open: `http://localhost:5335` or the port you mapped.

On older hosts (even with very old Node), **Docker** is enough: during `docker build`, the frontend is built inside the container on Node 20; runtime uses Bun in its base image. Host Node version is not used.

### Development mode

- Server with auto-reload: `bun run dev`
- Frontend with hot reload (proxying to API on 5335): `bun run frontend:dev` — UI at `http://localhost:5336`

## Request pipeline (from UI to target API and back)

1. **Browser (React)** — you click “Send”. The UI forms payload `{ url, method, headers?, body?, keycloak? }` and sends **POST /api/execute** to our server (port 5335).

2. **Bun server (`server.ts`)** — accepts `/api/execute`, parses JSON. If `keycloak` is provided — it requests a token from Keycloak (`getKeycloakToken`) and sets **Authorization: Bearer <token>** in headers. Otherwise it uses only manual headers.

3. **Proxy request to target API** — server performs **fetch(url, { method, headers, body })** to the user-provided URL. Since the request is made by our server, this bypasses browser CORS restrictions.

4. **Target API response** — server reads `status`, `statusText`, headers and body. For binary responses (e.g. `application/octet-stream`) the body is returned as `bodyBase64`. The request is added to **history**, and the client receives JSON `{ status, statusText, headers, body?, bodyBase64?, contentType }`.

5. **Browser** — receives `/api/execute` response, writes to **logs**, shows the result (JSON/table/XML), or triggers file download when `bodyBase64` is present.

In short: **browser → our API (5335) → [optional Keycloak token] → target URL → target response → our API → browser**.

## Features

- **REST** — URL, GET/POST/PUT/DELETE, JSON body, history by URL/method
- **SOAP** — URL, SOAPAction, XML body; response is formatted XML
- **GraphQL** — endpoint URL, Query, Variables, Operation name; “Load schema” button (introspection)
- **Files (S3-compatible API)**:
  - **Download** — GET by URL, save as file (name from `Content-Disposition` or URL path)
  - **Simple upload** — single PUT with file body (presigned URLs, etc.)
  - **S3 Multipart** — init (`POST ?uploads`), upload parts (5–100 MB), complete (`CompleteMultipartUpload`)
- **Authentication** (shared for all tabs):
  - **Keycloak** — server, realm, client id/secret, username/password; token is set in `Authorization`
  - **Custom headers** — arbitrary name/value pairs
- **History** — unified list of last requests (REST/SOAP/GraphQL), tab filtering, selecting fills URL and parameters
- **Response view** — “JSON” (pretty), “Table” (from JSON), XML formatting for SOAP/schema; file downloads via `bodyBase64`
- **Theme** — light/dark (stored in localStorage)
- **HTTPS** — “Do not verify SSL certificate” option for test environments with self-signed certs

History is stored in `data/history.json`. Optional: set `HISTORY_ENCRYPTION_KEY` in `.env` (32 bytes base64 or 64 hex chars, e.g. `openssl rand -base64 32`) — then Keycloak password, Keycloak client secret, and the `Authorization` header value in history are encrypted (AES-256-GCM).

