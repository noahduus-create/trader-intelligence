const TELEGRAM_MAX_LENGTH = 4096;
const PARSE_ERROR_PATTERN = /can't parse|parse_entities|entity|markdown/i;

export interface TelegramInput {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function sendTelegram(input: TelegramInput): Promise<void> {
  const chunks = chunkForTelegram(input.text);
  for (const chunk of chunks) {
    await sendOneChunk({ ...input, text: chunk });
  }
}

export function chunkForTelegram(text: string, limit = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    const lastNewline = window.lastIndexOf('\n');
    const splitAt = lastNewline > Math.floor(limit / 2) ? lastNewline : limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function sendOneChunk(input: TelegramInput): Promise<void> {
  const f = input.fetchImpl ?? fetch;
  const maxRetries = input.maxRetries ?? 3;
  const baseDelay = input.retryDelayMs ?? 500;

  const postOnce = async (parseMode: 'Markdown' | undefined) => {
    const res = await f(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      }),
    });
    const body = res.ok ? '' : await res.text();
    return { ok: res.ok, status: res.status, body };
  };

  let lastError = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await postOnce('Markdown');
    if (result.ok) return;

    lastError = `HTTP ${result.status}: ${result.body}`;

    if (result.status === 400 && PARSE_ERROR_PATTERN.test(result.body)) {
      const plain = await postOnce(undefined);
      if (plain.ok) return;
      throw new Error(`Telegram sendMessage failed (plain-text fallback): HTTP ${plain.status}: ${plain.body}`);
    }

    if (result.status === 429 || result.status >= 500) {
      await sleep(baseDelay * Math.pow(2, attempt));
      continue;
    }

    break;
  }

  throw new Error(`Telegram sendMessage failed: ${lastError}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
