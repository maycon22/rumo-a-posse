-- Rumo à Posse · aba Concursos alimentada pelo Qconcursos Folha Dirigida (20/11/2026)
-- Já aplicado no projeto Supabase. Guardado aqui como registro.
-- A função está em supabase/functions/sync-concursos/index.ts.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.site_concursos
  add column if not exists chave text,
  add column if not exists origem text not null default 'manual',
  add column if not exists area text not null default '',
  add column if not exists orgao_nome text not null default '',
  add column if not exists status_fonte text not null default '',
  add column if not exists inscricoes text not null default '',
  add column if not exists provas text not null default '',
  add column if not exists fonte_url text not null default '';
alter table public.site_concursos add constraint concursos_chave_uq unique (chave);
alter table public.site_concursos add constraint concursos_fonte_url check (fonte_url ~ '^(https?://.*)?$');
alter table public.site_concursos add constraint concursos_origem_ok check (origem in ('manual','folha'));
create index if not exists site_concursos_origem_area_idx on public.site_concursos (origem, area);

-- segredo aleatório no Vault: só o agendador consegue disparar a função
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'), 'site_sync_concursos_secret', 'Autoriza o pg_cron a chamar a função sync-concursos');

create or replace function public.site_sync_segredo_ok(p text)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from vault.decrypted_secrets where name = 'site_sync_concursos_secret' and decrypted_secret = p) $$;
revoke execute on function public.site_sync_segredo_ok(text) from public, anon, authenticated;
grant execute on function public.site_sync_segredo_ok(text) to service_role;

-- concursos antigos cadastrados à mão saíram do ar (continuam no banco)
update public.site_concursos set publicado = false where origem = 'manual';

-- roda às 06h e 18h de Brasília
select cron.schedule('sync-concursos-folha', '0 9,21 * * *', $$
  select net.http_post(
    url := 'https://hdegaqyvolsqgydwuyau.supabase.co/functions/v1/sync-concursos',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'site_sync_concursos_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);

-- Links das páginas dos concursos nas bancas (preenchidos pela função; Vunesp à mão)
alter table public.site_concursos add column if not exists links_banca jsonb not null default '[]'::jsonb;
alter table public.site_concursos add constraint concursos_links_banca_array check (jsonb_typeof(links_banca) = 'array');
