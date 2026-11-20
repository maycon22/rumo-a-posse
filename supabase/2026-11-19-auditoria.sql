-- =====================================================================
-- Rumo à Posse · melhorias de segurança e desempenho (auditoria 19/11/2026)
-- Já aplicado no projeto Supabase "Mesa de Estudos". Guardado aqui como registro.
-- =====================================================================

-- 1) Políticas do site: leitura pública só do que está publicado; escrita só do admin.
--    Separa SELECT por papel (tira o aviso "multiple permissive policies") e
--    chama site_is_admin() uma vez por consulta, não por linha.
do $$
declare t text;
begin
  foreach t in array array['site_artigos','site_concursos','site_produtos'] loop
    execute format('drop policy if exists "ler publicados" on public.%I', t);
    execute format('drop policy if exists "admin edita" on public.%I', t);
    execute format('create policy "leitura anonima" on public.%I for select to anon using (publicado)', t);
    execute format('create policy "leitura autenticada" on public.%I for select to authenticated using (publicado or (select public.site_is_admin()))', t);
    execute format('create policy "admin insere" on public.%I for insert to authenticated with check ((select public.site_is_admin()))', t);
    execute format('create policy "admin altera" on public.%I for update to authenticated using ((select public.site_is_admin())) with check ((select public.site_is_admin()))', t);
    execute format('create policy "admin apaga" on public.%I for delete to authenticated using ((select public.site_is_admin()))', t);
  end loop;
end $$;

drop policy if exists "ler config" on public.site_config;
drop policy if exists "admin edita" on public.site_config;
create policy "leitura config" on public.site_config for select to anon, authenticated using (true);
create policy "admin insere" on public.site_config for insert to authenticated with check ((select public.site_is_admin()));
create policy "admin altera" on public.site_config for update to authenticated using ((select public.site_is_admin())) with check ((select public.site_is_admin()));
create policy "admin apaga" on public.site_config for delete to authenticated using ((select public.site_is_admin()));

-- 2) Visitante anônimo não precisa (nem pode) escrever nas tabelas do site.
revoke insert, update, delete, truncate, references, trigger
  on public.site_artigos, public.site_concursos, public.site_produtos, public.site_config, public.site_admins
  from anon;
revoke all on public.site_admins from authenticated;

-- 3) Funções
revoke execute on function public.site_is_admin() from public, anon;
grant execute on function public.site_is_admin() to authenticated;

alter function public.site_touch() set search_path = '';
revoke execute on function public.site_touch() from public, anon, authenticated;

-- 4) Mesa de Estudos: auth.uid() avaliado uma vez por consulta
alter policy "ler os proprios documentos"    on public.documentos using ((select auth.uid()) = user_id);
alter policy "apagar os proprios documentos" on public.documentos using ((select auth.uid()) = user_id);
alter policy "alterar os proprios documentos" on public.documentos using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "criar os proprios documentos"  on public.documentos with check ((select auth.uid()) = user_id);

-- 5) Validação dos dados (bloqueia links "javascript:" e cores inválidas, mesmo se alguém burlar o painel)
alter table public.site_artigos   add constraint artigos_slug_ok  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
alter table public.site_artigos   add constraint artigos_capa_url check (imagem_capa ~ '^(https?://.*)?$');
alter table public.site_concursos add constraint concursos_link_url check (link_edital ~ '^(https?://.*)?$');
alter table public.site_produtos  add constraint produtos_link_url check (link_checkout ~ '^(https?://.*)?$');
alter table public.site_produtos  add constraint produtos_img_url  check (imagem ~ '^(https?://.*)?$');
alter table public.site_produtos  add constraint produtos_cor_ok   check (cor ~ '^#[0-9a-fA-F]{6}$');

-- 6) Newsletter de verdade: visitante só consegue inserir; só o admin lê e apaga.
create table if not exists public.site_newsletter (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  origem text not null default 'site',
  criado_em timestamptz not null default now(),
  constraint newsletter_email_ok check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index if not exists site_newsletter_email_uq on public.site_newsletter (lower(email));
alter table public.site_newsletter enable row level security;
revoke all on public.site_newsletter from anon, authenticated;
grant insert (email, origem) on public.site_newsletter to anon, authenticated;
grant select, delete on public.site_newsletter to authenticated;
create policy "visitante se inscreve" on public.site_newsletter for insert to anon, authenticated
  with check (origem = 'site');
create policy "admin le inscritos" on public.site_newsletter for select to authenticated
  using ((select public.site_is_admin()));
create policy "admin apaga inscritos" on public.site_newsletter for delete to authenticated
  using ((select public.site_is_admin()));
