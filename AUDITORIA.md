# Auditoria · Rumo à Posse (19/11/2026)

## Back-end (Supabase) · já aplicado no banco
| # | Problema | Gravidade | O que foi feito |
|---|---|---|---|
| 1 | Visitante anônimo tinha permissão de INSERT/UPDATE/DELETE nas tabelas do site (só o RLS segurava) | Média | Permissões de escrita removidas do papel `anon` (defesa em camadas) |
| 2 | `site_is_admin()` (SECURITY DEFINER) executável por qualquer visitante | Média | Execução revogada de `anon`; continua para usuário logado (o painel usa) |
| 3 | `site_touch()` sem `search_path` fixo | Baixa | `search_path = ''` |
| 4 | Políticas RLS duplicadas e `auth.uid()`/`site_is_admin()` recalculados linha a linha | Desempenho | Políticas separadas por papel e ação, com `(select …)`. Avisos de desempenho: 8 → 0 |
| 5 | Nada impedia links `javascript:` ou cores inválidas no banco | Média | Restrições CHECK em links, imagens, cor e slug |
| 6 | Newsletter era só demonstração (e-mails eram perdidos) | Negócio | Tabela `site_newsletter`: visitante só insere, só o admin lê/apaga |

SQL completo em `supabase/2026-11-19-auditoria.sql`.

## Front-end
- **SEO:** artigos agora têm endereço próprio (`?artigo=slug`), com título, descrição, canonical, Open Graph e dados estruturados (BlogPosting) por artigo. Links antigos `#artigo-…` redirecionam. `sitemap.xml` + GitHub Action que o atualiza todo dia.
- **Desempenho:** a lista não baixa mais o texto completo dos artigos (~150 KB a menos por visita); o texto vem só ao abrir o artigo. A última versão fica guardada no navegador e aparece na hora na volta do visitante. Esqueletos de carregamento no lugar da tela vazia. Scripts com `defer`.
- **Segurança:** Content-Security-Policy no site e no painel; Subresource Integrity nos scripts de CDN; script do painel movido para `admin.js`; texto do artigo passa pelo DOMPurify também no painel; se o DOMPurify falhar, o site mostra só texto (antes mostrava HTML cru); links validados (só http/https).
- **Acessibilidade:** link "Pular para o conteúdo", foco vai para o título ao trocar de página, Esc fecha o menu, tabela com legenda e cabeçalhos, avisos "abre em nova aba", preços riscados lidos corretamente.
- **Conversão:** botões sem link de pagamento mostram "Em breve" em vez de um botão "Comprar" que não faz nada; "Continue lendo" ao fim de cada artigo; e-mail de contato clicável.
- **Painel:** nova aba Newsletter (lista, exclusão e download CSV), aviso de alterações não salvas, mensagens de erro claras, correção do slug que podia terminar em hífen.

## Pendências que dependem de você
1. **Conteúdo de exemplo no ar:** 3 concursos "(exemplo)" e 6 materiais sem link de pagamento estão publicados. Edite ou despublique no painel.
2. **Links de pagamento** da Mesa de Estudos (mensal e anual) estão vazios em Configurações.
3. **Proteção contra senhas vazadas** (Supabase → Authentication → Settings): ativar se o seu plano permitir.
4. **Google Search Console:** cadastrar o site e enviar `https://maycon22.github.io/rumo-a-posse/sitemap.xml`.
5. **Imagem de compartilhamento** (og:image, 1200×630) para quando o link for enviado no WhatsApp/redes.
6. **Domínio próprio** (ex.: rumoaposse.com.br): ajuda na marca e no SEO; o e-mail de contato já usa esse domínio.
7. **Envio da newsletter:** exportar o CSV no painel e importar num serviço de e-mail (Brevo, MailerLite…).
