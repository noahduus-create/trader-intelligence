export interface RInput {
  side: 'buy' | 'sell';
  entry: number;
  exit: number;
  stop?: number;
  qty: number;
}

export function computeRMultiple(input: RInput): number | null {
  const { side, entry, exit, stop } = input;
  if (stop === undefined) return null;

  const initialRisk = Math.abs(entry - stop);
  if (initialRisk === 0) return null;

  const realizedMove = side === 'buy' ? exit - entry : entry - exit;
  return realizedMove / initialRisk;
}
