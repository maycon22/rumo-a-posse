-- Rumo à Posse + Mesa de Estudos · planos de estudo gerados dos editais (22/11/2026)
-- Fluxo: site_concursos (edital publicado) -> site_editais (PDF e texto) -> IA -> site_editais_planos (um por cargo)
-- -> o administrador confere no painel -> status 'aprovado' -> aparece no catálogo "Planos e concursos" do app.

-- 1. Um registro por edital (por concurso do site). Só o administrador vê; a função grava com a chave de serviço.
create table if not exists public.site_editais (
  id uuid primary key default gen_random_uuid(),
  concurso_chave text not null unique references public.site_concursos(chave) on delete cascade,
  status text not null default 'procurar'
    check (status in ('procurar','sem_pdf','ler','cargos','extrair','revisar','erro','ignorado','aguardando_ia')),
  pdf_url text not null default '' check (pdf_url ~ '^(https?://.*)?$'),
  pdf_origem text not null default '' check (pdf_origem in ('','auto','manual')),
  pdf_titulo text not null default '',
  candidatos jsonb not null default '[]'::jsonb check (jsonb_typeof(candidatos) = 'array'),
  texto text not null default '',
  paginas integer not null default 0,
  cargos jsonb not null default '[]'::jsonb check (jsonb_typeof(cargos) = 'array'),
  mensagem text not null default '',
  tentativas integer not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  custo_usd numeric(10,4) not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists site_editais_status_idx on public.site_editais (status, atualizado_em);

-- 2. Um plano por cargo. Público (site e app) só lê os aprovados.
create table if not exists public.site_editais_planos (
  id uuid primary key default gen_random_uuid(),
  edital_id uuid not null references public.site_editais(id) on delete cascade,
  concurso_chave text not null,
  cargo text not null check (length(cargo) between 1 and 300),
  disciplinas jsonb not null default '[]'::jsonb check (jsonb_typeof(disciplinas) = 'array'),
  n_disciplinas integer not null default 0,
  n_topicos integer not null default 0,
  info jsonb not null default '{}'::jsonb check (jsonb_typeof(info) = 'object'),
  status text not null default 'revisar' check (status in ('revisar','aprovado','rejeitado')),
  gerado_por text not null default 'ia' check (gerado_por in ('ia','manual')),
  aprovado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (edital_id, cargo)
);
create index if not exists site_editais_planos_status_idx on public.site_editais_planos (status, aprovado_em desc);
create index if not exists site_editais_planos_edital_idx on public.site_editais_planos (edital_id);

drop trigger if exists site_editais_touch on public.site_editais;
create trigger site_editais_touch before update on public.site_editais for each row execute function public.site_touch();
drop trigger if exists site_editais_planos_touch on public.site_editais_planos;
create trigger site_editais_planos_touch before update on public.site_editais_planos for each row execute function public.site_touch();

-- data de aprovação preenchida pelo banco (não pelo navegador)
create or replace function public.site_editais_planos_aprovacao() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'aprovado' and (tg_op = 'INSERT' or old.status is distinct from 'aprovado') then new.aprovado_em := now();
  elsif new.status <> 'aprovado' then new.aprovado_em := null; end if;
  new.n_disciplinas := jsonb_array_length(new.disciplinas);
  new.n_topicos := coalesce((select sum(jsonb_array_length(coalesce(d->'topicos','[]'::jsonb))) from jsonb_array_elements(new.disciplinas) d), 0);
  return new;
end $$;
drop trigger if exists site_editais_planos_aprovacao on public.site_editais_planos;
create trigger site_editais_planos_aprovacao before insert or update on public.site_editais_planos for each row execute function public.site_editais_planos_aprovacao();

-- 3. RLS
alter table public.site_editais enable row level security;
alter table public.site_editais_planos enable row level security;

revoke all on public.site_editais from anon;
revoke all on public.site_editais_planos from anon;
grant select on public.site_editais_planos to anon;
grant select, update, delete on public.site_editais to authenticated;
grant select, insert, update, delete on public.site_editais_planos to authenticated;

drop policy if exists "admin le editais" on public.site_editais;
drop policy if exists "admin altera editais" on public.site_editais;
drop policy if exists "admin apaga editais" on public.site_editais;
create policy "admin le editais" on public.site_editais for select to authenticated using ((select public.site_is_admin()));
create policy "admin altera editais" on public.site_editais for update to authenticated using ((select public.site_is_admin())) with check ((select public.site_is_admin()));
create policy "admin apaga editais" on public.site_editais for delete to authenticated using ((select public.site_is_admin()));

drop policy if exists "leitura anonima planos aprovados" on public.site_editais_planos;
drop policy if exists "leitura autenticada planos" on public.site_editais_planos;
drop policy if exists "admin insere planos" on public.site_editais_planos;
drop policy if exists "admin altera planos" on public.site_editais_planos;
drop policy if exists "admin apaga planos" on public.site_editais_planos;
create policy "leitura anonima planos aprovados" on public.site_editais_planos for select to anon using (status = 'aprovado');
create policy "leitura autenticada planos" on public.site_editais_planos for select to authenticated using (status = 'aprovado' or (select public.site_is_admin()));
create policy "admin insere planos" on public.site_editais_planos for insert to authenticated with check ((select public.site_is_admin()));
create policy "admin altera planos" on public.site_editais_planos for update to authenticated using ((select public.site_is_admin())) with check ((select public.site_is_admin()));
create policy "admin apaga planos" on public.site_editais_planos for delete to authenticated using ((select public.site_is_admin()));

-- Lote (Message Batches API) usado na etapa "extrair"
alter table public.site_editais add column if not exists lote_id text not null default '';
alter table public.site_editais add column if not exists lote_enviado_em timestamptz;

-- Agendamento: a função ler-editais roda a cada 10 minutos (a chave secreta vem do Vault)
select cron.schedule('ler-editais', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://hdegaqyvolsqgydwuyau.supabase.co/functions/v1/ler-editais',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'site_sync_concursos_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);
