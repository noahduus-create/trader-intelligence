export interface AuthInput {
  apiUrl: string;
  username: string;
  password: string;
  appId: string;
  appVersion: string;
  cid: string;
  sec: string;
  fetchImpl?: typeof fetch;
}

export interface AccessToken {
  accessToken: string;
  mdAccessToken: string;
  expiresAt: Date;
  userId: number;
}

export async function fetchAccessToken(input: AuthInput): Promise<AccessToken> {
  const f = input.fetchImpl ?? fetch;

  const body = {
    name: input.username,
    password: input.password,
    appId: input.appId,
    appVersion: input.appVersion,
    cid: input.cid,
    sec: input.sec,
  };

  const res = await f(`${input.apiUrl}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tradovate auth HTTP ${res.status}: ${redactAuthBody(text, input)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  if ('p-ticket' in data) {
    throw new Error(
      `Tradovate p-ticket challenge — 2FA required. Resolve manually first and re-run.`,
    );
  }

  if (typeof data.accessToken !== 'string') {
    throw new Error(`Tradovate auth: missing accessToken in response`);
  }

  return {
    accessToken: data.accessToken,
    mdAccessToken: (data.mdAccessToken as string) ?? '',
    expiresAt: new Date(data.expirationTime as string),
    userId: data.userId as number,
  };
}

// Some auth endpoints echo back the submitted credentials or app secret in
// 4xx error bodies. Strip the values we know are sensitive before letting the
// body land in an Error.message (which often flows to logs / Telegram / Sentry).
export function redactAuthBody(body: string, input: AuthInput): string {
  const truncated = body.slice(0, 200);
  return truncated
    .split(input.password).join('[REDACTED]')
    .split(input.sec).join('[REDACTED]')
    .split(input.cid).join('[REDACTED]');
}
