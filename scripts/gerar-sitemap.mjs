// Gera sitemap.xml com as páginas do site e todos os artigos publicados no Supabase.
// Uso: node scripts/gerar-sitemap.mjs   (roda sozinho todo dia pelo GitHub Actions)
import { readFileSync, writeFileSync } from "node:fs";

const SITE = "https://maycon22.github.io/rumo-a-posse/";
const cfg = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const URL_SB = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1];
const KEY = cfg.match(/SUPABASE_KEY:\s*"([^"]+)"/)[1];

const r = await fetch(`${URL_SB}/rest/v1/site_artigos?select=slug,atualizado_em,data_publicacao&publicado=eq.true&order=data_publicacao.desc`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!r.ok) throw new Error(`Supabase respondeu ${r.status}: ${await r.text()}`);
const artigos = await r.json();

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dia = d => String(d).slice(0, 10);
const ultimo = artigos.length ? dia(artigos.map(a => a.atualizado_em || a.data_publicacao).sort().at(-1)) : null;
const urls = [
  { loc: SITE, lastmod: ultimo },
  ...artigos.map(a => ({ loc: `${SITE}?artigo=${encodeURIComponent(a.slug)}`, lastmod: dia(a.atualizado_em || a.data_publicacao) }))
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>
`;
writeFileSync(new URL("../sitemap.xml", import.meta.url), xml);
console.log(`sitemap.xml: ${urls.length} endereços`);
