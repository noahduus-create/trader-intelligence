import { describe, it, expect } from 'vitest';
import { buildUserPrompt, CLASSIFY_SYSTEM_PROMPT } from '../src/classify/prompt.js';

describe('buildUserPrompt', () => {
  const baseTrade = {
    symbol: 'MNQU5',
    side: 'buy',
    qty: 2,
    entry_price: 18500,
    exit_price: 18510,
    entry_at: '2026-05-13T14:35:00Z',
    exit_at: '2026-05-13T14:55:00Z',
    pnl_usd: 20,
    r_multiple: 1.5,
  };

  it('renders the core trade fields', () => {
    const out = buildUserPrompt(baseTrade);
    expect(out).toContain('Symbol: MNQU5');
    expect(out).toContain('Side: buy');
    expect(out).toContain('R-multiple: 1.50');
  });

  it('omits session context when not provided', () => {
    const out = buildUserPrompt(baseTrade);
    expect(out).not.toContain('Session context:');
  });

  it('includes session context when provided', () => {
    const out = buildUserPrompt({
      ...baseTrade,
      session_context: {
        trade_index: 3,
        total_trades_in_session: 5,
        cumulative_pnl_before: -150,
        prior_trade_result: 'loss',
        consecutive_losses_before: 2,
        time_of_day: 'rth_open',
        day_of_week: 'wednesday',
        minutes_since_prior_exit: 4,
      },
    });
    expect(out).toContain('Session context:');
    expect(out).toContain('trade_index: 3 of 5');
    expect(out).toContain('consecutive_losses_before: 2');
    expect(out).toContain('minutes_since_prior_exit: 4');
    expect(out).toContain('cumulative_pnl_before: -150.00');
  });

  it('includes execution profile when provided', () => {
    const out = buildUserPrompt({
      ...baseTrade,
      execution_profile: {
        scale_in_count: 3,
        scale_out_count: 1,
        entry_span_seconds: 30,
        exit_span_seconds: 0,
        position_held_seconds: 600,
      },
    });
    expect(out).toContain('Execution profile:');
    expect(out).toContain('scale_in_count: 3');
    expect(out).toContain('scale_out_count: 1');
    expect(out).toContain('entry_span_seconds: 30');
  });

  it('omits execution profile when not provided', () => {
    const out = buildUserPrompt(baseTrade);
    expect(out).not.toContain('Execution profile:');
  });

  it('renders both session context and execution profile together', () => {
    const out = buildUserPrompt({
      ...baseTrade,
      session_context: {
        trade_index: 1,
        total_trades_in_session: 1,
        cumulative_pnl_before: 0,
        prior_trade_result: null,
        consecutive_losses_before: 0,
        time_of_day: 'rth_open',
        day_of_week: 'monday',
        minutes_since_prior_exit: null,
      },
      execution_profile: {
        scale_in_count: 1,
        scale_out_count: 1,
        entry_span_seconds: 0,
        exit_span_seconds: 0,
        position_held_seconds: 1200,
      },
    });
    expect(out).toContain('Session context:');
    expect(out).toContain('Execution profile:');
  });
});

describe('CLASSIFY_SYSTEM_PROMPT', () => {
  it('describes the revenge-trade rule', () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/revenge/i);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/consecutive_losses_before/);
  });

  it('describes the scale-discipline rule', () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/scale_in_count/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/oversized/);
  });
});
