import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAccessToken, redactAuthBody } from '../src/tradovate/auth.js';

describe('fetchAccessToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns access token from successful auth response', async () => {
    const mockResponse = {
      accessToken: 'TEST-ACCESS-TOKEN',
      mdAccessToken: 'TEST-MD-TOKEN',
      expirationTime: '2026-05-13T15:00:00Z',
      userId: 12345,
      name: 'noahduus',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await fetchAccessToken({
      apiUrl: 'https://demo.tradovateapi.com/v1',
      username: 'u',
      password: 'p',
      appId: 'app',
      appVersion: '1.0',
      cid: 'cid',
      sec: 'sec',
      fetchImpl: fetchMock,
    });

    expect(result.accessToken).toBe('TEST-ACCESS-TOKEN');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://demo.tradovateapi.com/v1/auth/accesstokenrequest',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws when API returns p-ticket challenge (2FA required)', async () => {
    const challengeResponse = {
      'p-ticket': 'CHALLENGE-TICKET',
      'p-time': 60,
      'p-captcha': false,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => challengeResponse,
    });

    await expect(
      fetchAccessToken({
        apiUrl: 'https://demo.tradovateapi.com/v1',
        username: 'u',
        password: 'p',
        appId: 'app',
        appVersion: '1.0',
        cid: 'cid',
        sec: 'sec',
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/p-ticket challenge/);
  });

  it('throws on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      fetchAccessToken({
        apiUrl: 'https://demo.tradovateapi.com/v1',
        username: 'u',
        password: 'p',
        appId: 'app',
        appVersion: '1.0',
        cid: 'cid',
        sec: 'sec',
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/401/);
  });

  it('redacts password and secret from HTTP error body', async () => {
    const SECRET_PASS = 'my-real-password';
    const SECRET_SEC = 'my-app-secret';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => `Invalid credentials for user with password ${SECRET_PASS} and sec ${SECRET_SEC}`,
    });

    let caught: unknown;
    try {
      await fetchAccessToken({
        apiUrl: 'https://demo.tradovateapi.com/v1',
        username: 'noahduus',
        password: SECRET_PASS,
        appId: 'app',
        appVersion: '1.0',
        cid: 'my-cid',
        sec: SECRET_SEC,
        fetchImpl: fetchMock,
      });
    } catch (e) {
      caught = e;
    }

    const msg = (caught as Error).message;
    expect(msg).toContain('401');
    expect(msg).not.toContain(SECRET_PASS);
    expect(msg).not.toContain(SECRET_SEC);
    expect(msg).toContain('[REDACTED]');
  });
});

describe('redactAuthBody', () => {
  const input = {
    apiUrl: 'x', username: 'u', password: 'PASS123', appId: 'a', appVersion: '1', cid: 'CID-7', sec: 'SEC-9',
  };

  it('redacts password verbatim', () => {
    expect(redactAuthBody('error: PASS123 wrong', input)).toBe('error: [REDACTED] wrong');
  });

  it('redacts cid and sec', () => {
    expect(redactAuthBody('cid=CID-7 sec=SEC-9', input)).toBe('cid=[REDACTED] sec=[REDACTED]');
  });

  it('truncates to 200 chars before redaction', () => {
    const long = 'x'.repeat(500);
    expect(redactAuthBody(long, input)).toHaveLength(200);
  });
});
