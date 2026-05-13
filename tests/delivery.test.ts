import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeMarkdownSummary } from '../src/delivery/markdown.js';
import { sendTelegram } from '../src/delivery/telegram.js';

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
});
