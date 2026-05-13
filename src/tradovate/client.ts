export interface ClientInput {
  apiUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export async function tradovateGet<T>(
  input: ClientInput,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const f = input.fetchImpl ?? fetch;
  const url = new URL(`${input.apiUrl}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await f(url.toString(), {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tradovate GET ${path} HTTP ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}
