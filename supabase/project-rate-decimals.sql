-- Preserve cents in project billing rates.
-- Integer-like project.rate columns round 4.50 to 5 and 4.25 to 4.
alter table public.projects
  alter column rate type numeric(10, 2)
  using rate::numeric(10, 2);

alter table public.projects
  alter column budget type numeric(12, 2)
  using budget::numeric(12, 2);
