import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeMarkdownSummary } from '../src/delivery/markdown.js';
import { sendTelegram, chunkForTelegram } from '../src/delivery/telegram.js';

describe('writeMarkdownSummary', () => {
  let baseDir: string;
  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ti-test-'));
  });
  afterAll(async () => {
    await rm(baseDir, { recursive: true });
  });

  it('appends summary to date file under baseDir', async () => {
    const path = await writeMarkdownSummary({
      baseDir,
      date: '2026-05-13',
      content: '# Test summary',
    });

    expect(path).toBe(join(baseDir, '2026-05-13.md'));
    const onDisk = await readFile(path, 'utf-8');
    expect(onDisk).toContain('# Test summary');
  });

  it('appends with separator when file exists', async () => {
    await writeMarkdownSummary({ baseDir, date: '2026-05-14', content: 'First entry' });
    await writeMarkdownSummary({ baseDir, date: '2026-05-14', content: 'Second entry' });
    const onDisk = await readFile(join(baseDir, '2026-05-14.md'), 'utf-8');
    expect(onDisk).toMatch(/First entry[\s\S]*---[\s\S]*Second entry/);
  });
});

describe('sendTelegram', () => {
  it('POSTs to Telegram Bot API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    await sendTelegram({
      botToken: 'BOT',
      chatId: '12345',
      text: 'hello',
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botBOT/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });

    await expect(
      sendTelegram({ botToken: 'BOT', chatId: '12345', text: 'hi', fetchImpl: fetchMock }),
    ).rejects.toThrow(/400/);
  });

  it('chunks a message larger than 4096 chars across multiple sends', async () => {
    const long = 'a'.repeat(5000);
    const calls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string).text);
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await sendTelegram({ botToken: 'BOT', chatId: '12345', text: long, fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]!.length).toBeLessThanOrEqual(4096);
    expect(calls[1]!.length).toBeLessThanOrEqual(4096);
    expect((calls[0]! + calls[1]!).length).toBe(5000);
  });

  it('prefers newline boundaries when chunking', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ` + 'x'.repeat(50)).join('\n');
    const chunks = chunkForTelegram(lines, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    // each chunk should end at a complete line (no broken "line N x..." in the middle)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.endsWith(' ') || /\d$/.test(chunk) || chunk.endsWith('x')).toBe(true);
    }
  });

  it('retries on markdown parse error with plain text', async () => {
    let attempt = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      attempt++;
      const body = JSON.parse(init.body as string);
      if (attempt === 1) {
        expect(body.parse_mode).toBe('Markdown');
        return { ok: false, status: 400, text: async () => `Bad Request: can't parse entities` };
      }
      expect(body.parse_mode).toBeUndefined();
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await sendTelegram({
      botToken: 'BOT',
      chatId: '12345',
      text: 'has *unclosed bold',
      fetchImpl: fetchMock,
    });
    expect(attempt).toBe(2);
  });

  it('retries with backoff on 429 rate limit', async () => {
    let attempt = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt < 3) {
        return { ok: false, status: 429, text: async () => 'Too Many Requests' };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    });

    await sendTelegram({
      botToken: 'BOT',
      chatId: '12345',
      text: 'hi',
      fetchImpl: fetchMock,
      retryDelayMs: 1,
    });
    expect(attempt).toBe(3);
  });

  it('does not retry on 401 unauthorized', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      sendTelegram({ botToken: 'BAD', chatId: '12345', text: 'hi', fetchImpl: fetchMock, retryDelayMs: 1 }),
    ).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
