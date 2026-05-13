import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAccessToken } from '../src/tradovate/auth.js';

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
});
