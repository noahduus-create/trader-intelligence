-- Split flat mistakes[] into entry_mistakes[] + management_mistakes[]
-- per Shefrin-Statman taxonomy: entry-time errors and post-entry errors
-- have different root causes and require different remediation paths.
--
-- Migration strategy for existing rows:
--   entry_mistakes  ← full old mistakes array (conservative default)
--   management_mistakes ← empty (unknown without re-classification)
-- Re-run the classifier on old trades to get accurate split values.

alter table trader_intel.classifications
  add column if not exists entry_mistakes text[] not null default '{}',
  add column if not exists management_mistakes text[] not null default '{}',
  add column if not exists reasoning text not null default '';

-- Carry forward existing data: assume all old mistakes were entry-time
update trader_intel.classifications
  set entry_mistakes = mistakes
  where array_length(mistakes, 1) is not null;

alter table trader_intel.classifications
  drop column if exists mistakes;
