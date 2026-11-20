// Rumo à Posse · acompanha o Exame de Suficiência do CFC no site da FGV Conhecimento.
// Descobre a edição mais recente, a situação (ex.: "Em Andamento") e a lista de publicações
// (data, título, link) e guarda em site_config.cfc_fgv para a página do site.
// Roda todo dia pelo pg_cron, junto com a sincronização dos concursos.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const UA = { "User-Agent": "RumoAPosseBot/1.0 (+https://maycon22.github.io/rumo-a-posse/)" };
const BASE = "https://conhecimento.fgv.br";
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const dec = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) =>
  c[0] === "#" ? String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : (ENT[c.toLowerCase()] ?? m));
const txt = (h: string) => dec(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function pagina(url: string) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return (await r.text()).replace(/<script[\s\S]*?<\/script>/gi, "");
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await sb.rpc("site_sync_segredo_ok", { p: req.headers.get("x-sync-secret") ?? "" });
  if (!ok) return new Response("não autorizado", { status: 401 });

  try {
    // 1) edição mais recente listada pela FGV (ex.: /exames/cfc/2026.3)
    const lista = await pagina(`${BASE}/concursos`);
    const edicoes = [...new Set([...lista.matchAll(/\/exames\/cfc\/(\d{4}\.\d)/g)].map(m => m[1]))]
      .sort((a, b) => Number(b.replace(".", "")) - Number(a.replace(".", "")));
    if (!edicoes.length) throw new Error("nenhuma edição do CFC na lista da FGV");
    const edicao = edicoes[0], url = `${BASE}/exames/cfc/${edicao}`;

    // 2) situação e publicações da edição
    const h = await pagina(url);
    const titulo = txt((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ""])[1]) || `Exame de Suficiência ${edicao}`;
    const status = (h.match(/>\s*(Em Andamento|Encerrado|Inscrições Abertas|Inscrições Encerradas|Previsto|Suspenso|Cancelado)\s*</i) || [, ""])[1];
    const documentos: { data: string; titulo: string; url: string }[] = [];
    for (const bloco of h.split(/paragraph--type--texto-data/).slice(1)) {
      const data = (bloco.match(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})/) || [, ""])[1];
      for (const a of bloco.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const t = txt(a[2]);
        let u = dec(a[1]); if (u.startsWith("/")) u = BASE + u;
        if (t && /^https:\/\//.test(u)) documentos.push({ data, titulo: t, url: u });
      }
      if (documentos.length >= 40) break;
    }
    if (!documentos.length) throw new Error("nenhuma publicação encontrada; formato da página pode ter mudado");

    const valor = JSON.stringify({ edicao, titulo, status, url, documentos, edicoes: edicoes.slice(0, 8), lido_em: new Date().toISOString() });
    const { error } = await sb.from("site_config").upsert({ chave: "cfc_fgv", valor });
    if (error) throw error;
    return Response.json({ ok: true, edicao, status, documentos: documentos.length });
  } catch (e) {
    // falhou: mantém o que estava salvo
    return Response.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
});
