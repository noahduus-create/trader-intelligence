export interface TelegramInput {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
}

export async function sendTelegram(input: TelegramInput): Promise<void> {
  const f = input.fetchImpl ?? fetch;
  const res = await f(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      parse_mode: 'Markdown',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram sendMessage HTTP ${res.status}: ${text}`);
  }
}
