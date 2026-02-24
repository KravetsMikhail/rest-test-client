export interface KeycloakParams {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
}

export async function getKeycloakToken(params: KeycloakParams): Promise<string> {
  const url = `${params.serverUrl.replace(/\/$/, "")}/realms/${params.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: params.clientId,
    username: params.username,
    password: params.password,
  });
  if (params.clientSecret) {
    body.set("client_secret", params.clientSecret);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keycloak token error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}
