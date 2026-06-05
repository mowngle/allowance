import { SELF } from 'cloudflare:test';

export interface Creds {
  houseId: string;
  token: string;
  friendCode: string;
}

export async function registerHouse(name: string): Promise<Creds> {
  const res = await SELF.fetch('https://sb.test/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 200) throw new Error(`register failed: ${res.status}`);
  return (await res.json()) as Creds;
}

export function authHeaders(creds: Creds): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-House-Id': creds.houseId,
    Authorization: `Bearer ${creds.token}`,
  };
}

export async function authedFetch(
  creds: Creds,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return SELF.fetch(`https://sb.test${path}`, {
    ...init,
    headers: { ...authHeaders(creds), ...(init.headers as Record<string, string>) },
  });
}
