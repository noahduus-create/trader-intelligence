import { z } from 'zod';

export const TradeContextSchema = z.object({
  atr: z.number().optional(),
  orb_range: z.number().optional(),
  orb_atr_ratio: z.number().optional(),
  exit_reason: z.string().optional(),
  atr_percentile: z.number().min(0).max(100).optional(),
}).optional();
export type TradeContext = z.infer<typeof TradeContextSchema>;

export const ExecutionProfileSchema = z.object({
  scale_in_count: z.number().int().positive(),
  scale_out_count: z.number().int().positive(),
  entry_span_seconds: z.number().int().nonnegative(),
  exit_span_seconds: z.number().int().nonnegative(),
  position_held_seconds: z.number().int().nonnegative(),
}).optional();
export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;

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
  context: TradeContextSchema,
  execution_profile: ExecutionProfileSchema,
});
export type Trade = z.infer<typeof TradeSchema>;

export const SetupEnum = z.enum([
  'ORB', 'breakout', 'fade', 'news', 'momentum', 'mean_reversion', 'other',
]);
export const TimeOfDayEnum = z.enum([
  'pre_market', 'rth_open', 'rth_mid', 'rth_close', 'post_close',
]);
export const QualityEnum = z.enum(['A+', 'A', 'B', 'C']);
export const EntryMistakeEnum = z.enum([
  'chased_entry', 'oversized', 'fomo', 'revenge', 'no_plan', 'none',
]);
export const ManagementMistakeEnum = z.enum([
  'moved_stop', 'exited_early', 'held_too_long', 'none',
]);

export const ClassificationSchema = z.object({
  trade_id: z.string(),
  reasoning: z.string(),
  setup: SetupEnum,
  time_of_day: TimeOfDayEnum,
  quality: QualityEnum,
  entry_mistakes: z.array(EntryMistakeEnum),
  management_mistakes: z.array(ManagementMistakeEnum),
  notes: z.string(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export type Setup = z.infer<typeof SetupEnum>;
export type TimeOfDay = z.infer<typeof TimeOfDayEnum>;
export type Quality = z.infer<typeof QualityEnum>;
export type EntryMistake = z.infer<typeof EntryMistakeEnum>;
export type ManagementMistake = z.infer<typeof ManagementMistakeEnum>;
