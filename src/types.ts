import { z } from 'zod';

export const TradeSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  qty: z.number().int().positive(),
  entry_price: z.number(),
  exit_price: z.number(),
  stop_price: z.number().optional(),
  entry_at: z.string().datetime(),
  exit_at: z.string().datetime(),
  pnl_usd: z.number(),
  commission_usd: z.number().nonnegative(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const SetupEnum = z.enum([
  'ORB', 'breakout', 'fade', 'news', 'momentum', 'mean_reversion', 'other',
]);
export const TimeOfDayEnum = z.enum([
  'pre_market', 'rth_open', 'rth_mid', 'rth_close', 'post_close',
]);
export const QualityEnum = z.enum(['A+', 'A', 'B', 'C']);
export const MistakeEnum = z.enum([
  'chased_entry', 'moved_stop', 'oversized', 'fomo', 'revenge',
  'exited_early', 'held_too_long', 'no_plan', 'none',
]);

export const ClassificationSchema = z.object({
  trade_id: z.string(),
  setup: SetupEnum,
  time_of_day: TimeOfDayEnum,
  quality: QualityEnum,
  mistakes: z.array(MistakeEnum),
  notes: z.string(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export type Setup = z.infer<typeof SetupEnum>;
export type TimeOfDay = z.infer<typeof TimeOfDayEnum>;
export type Quality = z.infer<typeof QualityEnum>;
export type Mistake = z.infer<typeof MistakeEnum>;
