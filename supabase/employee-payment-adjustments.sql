alter table public.employees
  add column if not exists payment_adjustments jsonb not null default '[]'::jsonb;

comment on column public.employees.payment_adjustments is
  'Bonuses and deductions included in employee earnings statements.';

notify pgrst, 'reload schema';
