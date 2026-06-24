alter table public.clients
  add column if not exists cc_emails text[];

alter table public.employees
  add column if not exists cc_emails text[];

alter table public.invoices
  add column if not exists client_cc_emails text[];
