// Rumo à Posse · lê os editais publicados e prepara planos de estudo para a Mesa de Estudos.
//
// Etapas (cada edital anda uma etapa por execução; o pg_cron chama a cada 10 minutos):
//   procurar -> acha o PDF do edital (página da banca: FCC, API do Cebraspe; ou link da matéria da Folha)
//   ler      -> baixa o PDF e separa o texto do conteúdo programático
//   cargos   -> a IA lista os cargos do edital (chamada rápida)
//   extrair  -> a IA monta disciplinas e tópicos de cada cargo (lote da API de batches: mais barato e sem limite de tempo)
//   revisar  -> planos prontos; o administrador confere e aprova no painel do site
// Só planos com status 'aprovado' aparecem no catálogo "Planos e concursos" do app.
//
// Segredos (Supabase -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY       obrigatória para as etapas de IA (sem ela, os editais param em "aguardando_ia")
//   EDITAL_MODELO           opcional, padrão claude-sonnet-5-5
//   EDITAL_LIMITE_USD_MES   opcional, padrão 15 (teto de gasto com IA por mês, em dólares)
//   EDITAL_MAX_CARGOS       opcional, padrão 12 (cargos por edital)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODELO = Deno.env.get("EDITAL_MODELO") || "claude-sonnet-5-5";
const LIMITE_USD_MES = Number(Deno.env.get("EDITAL_LIMITE_USD_MES") || 15);
const MAX_CARGOS = Math.max(1, Math.min(30, Number(Deno.env.get("EDITAL_MAX_CARGOS") || 12)));
const MAX_PDF = 30 * 1024 * 1024;      // 30 MB
const MAX_TEXTO = 400_000;             // caracteres do conteúdo programático enviados à IA (~110 mil tokens)
const UA = { "User-Agent": "RumoAPosseBot/1.0 (+https://maycon22.github.io/rumo-a-posse/)" };
// US$ por milhão de tokens: entrada, saída, gravação de cache de 1 h, leitura de cache. Modelo desconhecido usa o do Sonnet.
const PRECOS: Record<string, number[]> = { "claude-sonnet-5-5": [2, 10, 4, 0.2], "claude-opus-5-5": [4, 20, 8, 0.4] };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const corta = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const decodificar = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => c[0] === "#" ? String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ordm: "º", ordf: "ª", ndash: "–", mdash: "—" } as Record<string, string>)[c.toLowerCase()] ?? m);

/* ---------------- 1. achar o PDF do edital ---------------- */
async function baixarHtml(url: string) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  let html = new TextDecoder(/iso-8859-1|latin1|windows-1252/.test(ct) ? "windows-1252" : "utf-8").decode(buf);
  if (!/charset/.test(ct) && /<meta[^>]+charset=["']?(iso-8859-1|windows-1252)/i.test(html)) html = new TextDecoder("windows-1252").decode(buf);
  return html;
}
function linksPdf(html: string, base: string) {
  const out: { url: string; titulo: string }[] = [];
  for (const m of html.replace(/<script[\s\S]*?<\/script>/gi, "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]; if (!href) continue;
    let url: string; try { url = new URL(decodificar(href), base).href; } catch { continue; }
    // visualizadores (ex.: acessibilidade da FCC) trazem o PDF de verdade no parâmetro "file"
    try { const f = new URL(url).searchParams.get("file"); if (f && /\.pdf(\?|#|$)/i.test(f)) url = new URL(f, url).href; } catch (_) { /* segue */ }
    if (!/^https?:/.test(url) || !(/\.pdf(\?|#|$)/i.test(url) || /arquivos\.qconcursos\.com\//i.test(url))) continue;
    const partes = [m[2].replace(/<[^>]+>/g, " "), ...[...m[2].matchAll(/alt\s*=\s*["']([^"']*)["']/gi)].map(x => x[1]), /title\s*=\s*["']([^"']*)["']/i.exec(m[1])?.[1] || ""]
      .map(p => corta(decodificar(p), 200)).filter(Boolean);
    const titulo = corta([...new Map(partes.map(p => [norm(p), p])).values()].join(" · "), 200);
    out.push({ url, titulo: titulo || decodeURIComponent(url.split("/").pop() || "") });
  }
  return out;
}
async function arquivosCebraspe(codigo: string) {
  const r = await fetch(`https://apis.cebraspe.org.br/cebraspe/eventos/${encodeURIComponent(codigo)}`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.arquivosEdital || []).filter((a: any) => /pdf/i.test(a.tipoExtensaoArquivo || a.nomeArquivo))
    .map((a: any) => ({ url: `https://cdn.cebraspe.org.br/concursos/${codigo}/arquivos/${a.nomeArquivo}`, titulo: corta(a.descricaoArquivo, 200) }));
}
function pontuar(c: { url: string; titulo: string }) {
  const t = norm(c.titulo + " " + decodeURIComponent(c.url.split("/").pop() || ""));
  let p = 0;
  if (/edital/.test(t)) p += 10;
  if (/abertura|edital n 0?1\b|edital n 1 |edital 0?1\b|edital oficial|edital n 01/.test(t)) p += 8;
  if (/atualizad|consolidad|retificado/.test(t)) p += 3;
  if (/retificacao|errata|extrato|resultado|gabarito|convoca|homolog|isenc|recurso|impugna|locais|local de prova|inscritos|deferid|comunicado|aviso|cronograma|classifica|nomea|resposta|prorroga|alteracao|aditivo/.test(t)) p -= 14;
  return p;
}
async function acharPdf(c: any) {
  const cand: { url: string; titulo: string; fonte: string }[] = [];
  const paginas: string[] = [];
  for (const l of c.links_banca || []) if (l?.url) paginas.push(l.url);
  const mat = c.detalhes?.materia_url; if (mat) paginas.push(mat);
  if (/\/n\/concurso-/.test(c.fonte_url || "")) paginas.push(c.fonte_url);
  for (const p of [...new Set(paginas)].slice(0, 5)) {
    try {
      const ceb = /cebraspe\.org\.br\/concursos\/([A-Za-z0-9_]+)/.exec(p);
      const achados = ceb ? await arquivosCebraspe(ceb[1]) : linksPdf(await baixarHtml(p), p);
      for (const a of achados) cand.push({ ...a, fonte: new URL(p).hostname });
    } catch (_) { /* página fora do ar: segue */ }
  }
  const unicos = [...new Map(cand.map(x => [x.url, x])).values()].map(x => ({ ...x, pontos: pontuar(x) })).sort((a, b) => b.pontos - a.pontos);
  return { melhor: unicos[0] && unicos[0].pontos >= 10 ? unicos[0] : null, candidatos: unicos.slice(0, 10) };
}

/* ---------------- 2. ler o PDF ---------------- */
// procurado no texto sem acentos: alguns PDFs guardam o acento como caractere separado
const RE_SECAO = /\b(conteudos? programaticos?|objetos? de avaliacao|conhecimentos basicos|conhecimentos gerais|programas? das? provas?)\b/;
const MIN_SECAO = 15_000;
async function lerPdf(url: string) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`não consegui baixar o PDF (HTTP ${r.status})`);
  const tam = Number(r.headers.get("content-length") || 0); if (tam > MAX_PDF) throw new Error(`PDF grande demais (${Math.round(tam / 1048576)} MB)`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_PDF) throw new Error(`PDF grande demais (${Math.round(buf.length / 1048576)} MB)`);
  if (String.fromCharCode(...buf.slice(0, 5)) !== "%PDF-") throw new Error("o link não é um PDF");
  const pdf = await getDocumentProxy(buf);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const paginas = (text as string[]).map(t => t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  const total = paginas.join("").length;
  if (total < 500) throw new Error("o PDF não tem texto (parece escaneado); use outro arquivo");
  // a seção do conteúdo programático costuma ficar nos anexos: primeira página com o título a partir de 1/4 do documento
  return { ...recortarSecao(paginas), paginas: totalPages };
}
function recortarSecao(paginas: string[]) {
  const totalPages = paginas.length;
  const com = paginas.map((t, i) => RE_SECAO.test(norm(t)) ? i : -1).filter(i => i >= 0);
  const desde = (i: number) => paginas.slice(i).join("").length;
  let ini = com.find(i => i >= Math.floor(totalPages * 0.25)) ?? com[0] ?? 0;
  // trecho pequeno demais: o título achado não era o do conteúdo; tenta outro ou usa o documento todo
  if (desde(ini) < MIN_SECAO) ini = com.find(i => i >= Math.floor(totalPages * 0.1) && desde(i) >= MIN_SECAO) ?? 0;
  let texto = paginas.slice(ini).map((t, k) => `[página ${ini + k + 1}]\n${t}`).join("\n\n");
  // documento todo e grande: o conteúdo programático costuma estar no fim
  if (texto.length > MAX_TEXTO) texto = ini === 0 ? texto.slice(-MAX_TEXTO) : texto.slice(0, MAX_TEXTO);
  return { texto, inicio: ini + 1 };
}

/* ---------------- 3. IA ---------------- */
const SISTEMA = "Você extrai dados de editais de concursos públicos brasileiros. Use exclusivamente o texto do edital fornecido entre <edital> e </edital>. Nunca invente cargos, disciplinas ou tópicos e não complete com conhecimento próprio. Responda apenas com um objeto JSON válido, sem comentários e sem blocos de código.";
const blocoEdital = (c: any, texto: string) => ({ type: "text", text: `<edital orgao="${corta(c.orgao_nome || c.orgao, 120)}" banca="${corta(c.banca, 60)}">\n${texto}\n</edital>`, cache_control: { type: "ephemeral", ttl: "1h" } });
const pedidoCargos = (c: any) => `Liste os cargos deste edital que têm conteúdo programático próprio (cargo com área ou especialidade, quando o conteúdo muda por área). Formato: {"cargos":[{"nome":"nome do cargo como aparece no edital"}]}. Máximo de ${MAX_CARGOS} cargos; se houver mais, dê preferência aos que combinam com "${corta(c.cargo, 150)}". Se o conteúdo for o mesmo para todos, devolva um único cargo com o nome principal.`;
const pedidoConteudo = (cargo: string) => `Monte o conteúdo programático completo do cargo "${cargo}". Inclua todas as disciplinas cobradas desse cargo: as de conhecimentos gerais ou básicos e as específicas. Para cada disciplina, liste os tópicos na ordem do edital: cada item numerado (1, 2, 3...) é um tópico; subitens (1.1, 1.2, a, b...) vão em "sub" do tópico. Copie o texto do edital, tirando só a numeração. Não resuma, não junte, não acrescente. Formato: {"disciplinas":[{"nome":"Língua Portuguesa","topicos":[{"t":"Compreensão e interpretação de textos","sub":[]}]}]}. Se o edital não trouxer conteúdo para esse cargo, responda {"disciplinas":[]}.`;
function parametros(c: any, texto: string, pedido: string, maxTokens: number, esforco: string) {
  return { model: MODELO, max_tokens: maxTokens, system: SISTEMA, output_config: { effort: esforco }, messages: [{ role: "user", content: [blocoEdital(c, texto), { type: "text", text: pedido }] }] };
}
function custo(u: any, lote = false) {
  const [pi, po, pcw, pcr] = PRECOS[MODELO] || PRECOS["claude-sonnet-5-5"], f = lote ? 0.5 : 1;
  const entrada = (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0);
  const usd = f * ((u?.input_tokens || 0) * pi + (u?.cache_creation_input_tokens || 0) * pcw + (u?.cache_read_input_tokens || 0) * pcr + (u?.output_tokens || 0) * po) / 1e6;
  return { entrada, saida: u?.output_tokens || 0, usd };
}
async function anthropic(caminho: string, corpo?: unknown) {
  const r = await fetch(`https://api.anthropic.com/v1/${caminho}`, {
    method: corpo ? "POST" : "GET", signal: AbortSignal.timeout(110000),
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) { let m = txt; try { m = JSON.parse(txt)?.error?.message || txt; } catch (_) {} throw new Error(`IA respondeu ${r.status}: ${corta(m, 300)}`); }
  return txt;
}
function lerJson(texto: string) {
  const t = String(texto || ""), i = t.indexOf("{"), f = t.lastIndexOf("}");
  if (i < 0 || f < i) throw new Error("a IA não devolveu JSON");
  return JSON.parse(t.slice(i, f + 1));
}
function limparDisciplinas(v: any) {
  const ds = Array.isArray(v?.disciplinas) ? v.disciplinas : [];
  return ds.slice(0, 40).map((d: any) => ({
    nome: corta(d?.nome, 150),
    topicos: (Array.isArray(d?.topicos) ? d.topicos : []).slice(0, 200).map((t: any) => typeof t === "string" ? { t: corta(t, 600), sub: [] } : { t: corta(t?.t ?? t?.nome, 600), sub: (Array.isArray(t?.sub) ? t.sub : []).slice(0, 60).map((s: any) => corta(typeof s === "string" ? s : s?.t, 400)).filter(Boolean) }).filter((t: any) => t.t),
  })).filter((d: any) => d.nome && d.topicos.length);
}
// conferência: quantos tópicos aparecem de fato no texto do edital (sinal para a revisão, não substitui a leitura)
function conferencia(ds: any[], texto: string) {
  const base = " " + norm(texto) + " "; let n = 0, ok = 0;
  for (const d of ds) for (const t of d.topicos) { n++; const k = norm(t.t).split(" ").slice(0, 6).join(" "); if (k.length < 8 || base.includes(" " + k)) ok++; }
  return n ? Math.round(ok / n * 100) : 0;
}

/* ---------------- 4. trabalho ---------------- */
async function trabalhar(sb: any) {
  const ini = Date.now(), cedo = () => Date.now() - ini < 100_000;
  const rel: Record<string, unknown> = { modelo: MODELO, ia: !!KEY };
  const atualizar = (id: string, campos: Record<string, unknown>) => sb.from("site_editais").update(campos).eq("id", id);
  const falhou = async (e: any, ed: any, etapa: string) => {
    const t = (ed.tentativas || 0) + 1, msg = `${etapa}: ${corta(e?.message || e, 300)}`;
    await atualizar(ed.id, t >= 3 ? { status: "erro", tentativas: t, mensagem: msg } : { tentativas: t, mensagem: msg + " (vai tentar de novo)" });
  };
  const somarCusto = async (ed: any, c: { entrada: number; saida: number; usd: number }) => {
    const { data } = await sb.from("site_editais").select("tokens_entrada,tokens_saida,custo_usd").eq("id", ed.id).single();
    await atualizar(ed.id, { tokens_entrada: (data?.tokens_entrada || 0) + c.entrada, tokens_saida: (data?.tokens_saida || 0) + c.saida, custo_usd: Number(data?.custo_usd || 0) + c.usd });
  };

  // a) concursos com edital publicado que ainda não estão na fila
  const { data: concs } = await sb.from("site_concursos").select("chave").eq("publicado", true).in("situacao", ["aberto", "edital"]);
  const { data: fila } = await sb.from("site_editais").select("concurso_chave");
  const ja = new Set((fila || []).map((x: any) => x.concurso_chave));
  const novos = (concs || []).filter((c: any) => c.chave && !ja.has(c.chave)).map((c: any) => ({ concurso_chave: c.chave }));
  if (novos.length) await sb.from("site_editais").insert(novos);
  rel.novos = novos.length;

  // b) teto de gasto do mês
  const mes = new Date(); mes.setUTCDate(1); mes.setUTCHours(0, 0, 0, 0);
  const { data: gastos } = await sb.from("site_editais").select("custo_usd").gte("atualizado_em", mes.toISOString());
  const gasto = (gastos || []).reduce((s: number, x: any) => s + Number(x.custo_usd || 0), 0);
  const iaLiberada = !!KEY && gasto < LIMITE_USD_MES;
  rel.gasto_mes_usd = Math.round(gasto * 100) / 100;
  if (!KEY) await sb.from("site_editais").update({ status: "aguardando_ia", mensagem: "Falta a chave da IA (ANTHROPIC_API_KEY) nos segredos do Supabase." }).eq("status", "cargos");
  else await sb.from("site_editais").update({ status: "cargos", mensagem: "" }).eq("status", "aguardando_ia");
  if (KEY && !iaLiberada) rel.aviso = `teto de US$ ${LIMITE_USD_MES} do mês atingido; etapas de IA pausadas`;

  const conc = async (chave: string) => (await sb.from("site_concursos").select("chave,orgao,orgao_nome,cargo,banca,area,situacao,provas,inscricoes,links_banca,fonte_url,detalhes").eq("chave", chave).single()).data;

  // c) procurar PDFs (até 3 por vez)
  const { data: procurar } = await sb.from("site_editais").select("*").eq("status", "procurar").order("atualizado_em").limit(3);
  for (const ed of procurar || []) {
    if (!cedo()) break;
    try {
      if (ed.pdf_url) { await atualizar(ed.id, { status: "ler", mensagem: "" }); continue; }
      const c = await conc(ed.concurso_chave); if (!c) { await atualizar(ed.id, { status: "ignorado", mensagem: "concurso saiu do site" }); continue; }
      const { melhor, candidatos } = await acharPdf(c);
      await atualizar(ed.id, melhor
        ? { status: "ler", pdf_url: melhor.url, pdf_titulo: melhor.titulo, pdf_origem: "auto", candidatos, mensagem: "", tentativas: 0 }
        : { status: "sem_pdf", candidatos, mensagem: candidatos.length ? "Não achei com certeza o edital de abertura entre os PDFs encontrados. Escolha um ou cole o link." : "Não achei o PDF do edital nas páginas da banca e da matéria. Cole o link do PDF." });
    } catch (e) { await falhou(e, ed, "procurar PDF"); }
  }

  // d) ler um PDF por vez (o mais pesado em processamento)
  if (cedo()) {
    const { data: ler } = await sb.from("site_editais").select("*").eq("status", "ler").order("atualizado_em").limit(1);
    for (const ed of ler || []) {
      try {
        const t = await lerPdf(ed.pdf_url);
        await atualizar(ed.id, { status: KEY ? "cargos" : "aguardando_ia", texto: t.texto, paginas: t.paginas, tentativas: 0, mensagem: `Texto lido a partir da página ${t.inicio} de ${t.paginas}.` + (KEY ? "" : " Falta a chave da IA (ANTHROPIC_API_KEY).") });
        rel.lido = ed.concurso_chave;
      } catch (e) { await falhou(e, ed, "ler PDF"); }
    }
  }

  // e) listar cargos e enviar o lote de extração
  if (iaLiberada && cedo()) {
    const { data: cg } = await sb.from("site_editais").select("*").eq("status", "cargos").order("atualizado_em").limit(1);
    for (const ed of cg || []) {
      try {
        const c = await conc(ed.concurso_chave);
        const r = JSON.parse(await anthropic("messages", parametros(c, ed.texto, pedidoCargos(c), 2000, "low")));
        await somarCusto(ed, custo(r.usage));
        const nomes = [...new Set(((lerJson((r.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(""))?.cargos) || []).map((x: any) => corta(x?.nome ?? x, 250)).filter(Boolean))].slice(0, MAX_CARGOS) as string[];
        if (!nomes.length) throw new Error("a IA não encontrou cargos com conteúdo programático no texto");
        const lote = JSON.parse(await anthropic("messages/batches", { requests: nomes.map((n, i) => ({ custom_id: `c${i}`, params: parametros(c, ed.texto, pedidoConteudo(n), 32000, "medium") })) }));
        await atualizar(ed.id, { status: "extrair", cargos: nomes.map(n => ({ nome: n, status: "pendente" })), lote_id: lote.id, lote_enviado_em: new Date().toISOString(), tentativas: 0, mensagem: `${nomes.length} cargo(s) enviados para a IA.` });
        rel.lote = lote.id;
      } catch (e) { await falhou(e, ed, "listar cargos"); }
    }
  }

  // f) buscar resultados dos lotes prontos
  if (KEY && cedo()) {
    const { data: ex } = await sb.from("site_editais").select("*").eq("status", "extrair").order("atualizado_em").limit(3);
    for (const ed of ex || []) {
      if (!cedo()) break;
      try {
        const b = JSON.parse(await anthropic(`messages/batches/${ed.lote_id}`));
        if (b.processing_status !== "ended") { await atualizar(ed.id, { mensagem: `IA processando ${ed.cargos.length} cargo(s)…` }); continue; }
        const c = await conc(ed.concurso_chave);
        const linhas = (await anthropic(`messages/batches/${ed.lote_id}/results`)).split("\n").filter(Boolean).map(l => JSON.parse(l));
        const cargos = ed.cargos.map((x: any) => ({ ...x }));
        let tot = { entrada: 0, saida: 0, usd: 0 }, feitos = 0;
        for (const l of linhas) {
          const i = Number(String(l.custom_id).slice(1)), cargo = cargos[i]; if (!cargo) continue;
          if (l.result?.type !== "succeeded") { cargo.status = "erro"; cargo.erro = corta(l.result?.error?.error?.message || l.result?.type, 200); continue; }
          const m = l.result.message, u = custo(m.usage, true); tot = { entrada: tot.entrada + u.entrada, saida: tot.saida + u.saida, usd: tot.usd + u.usd };
          try {
            if (m.stop_reason === "max_tokens") throw new Error("resposta cortada (conteúdo grande demais)");
            const ds = limparDisciplinas(lerJson((m.content || []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("")));
            if (!ds.length) { cargo.status = "vazio"; continue; }
            const info = { orgao: c?.orgao || "", orgao_nome: c?.orgao_nome || "", banca: c?.banca || "", area: c?.area || "", situacao: c?.situacao || "", provas: c?.provas || "", inscricoes: c?.inscricoes || "",
              pdf_url: ed.pdf_url, pdf_titulo: ed.pdf_titulo, modelo: MODELO, conferencia_pct: conferencia(ds, ed.texto) };
            const { error } = await sb.from("site_editais_planos").upsert({ edital_id: ed.id, concurso_chave: ed.concurso_chave, cargo: cargo.nome, disciplinas: ds, info, status: "revisar", gerado_por: "ia" }, { onConflict: "edital_id,cargo" });
            if (error) throw error;
            cargo.status = "feito"; feitos++;
          } catch (e) { cargo.status = "erro"; cargo.erro = corta((e as any)?.message || e, 200); }
        }
        await somarCusto(ed, tot);
        await atualizar(ed.id, { status: feitos ? "revisar" : "erro", cargos, tentativas: 0, mensagem: feitos ? `${feitos} plano(s) prontos para revisão.` : "A IA não conseguiu montar nenhum plano deste edital." });
        rel.revisar = (rel.revisar as number || 0) + feitos;
      } catch (e) { await falhou(e, ed, "buscar resultado da IA"); }
    }
  }
  rel.ms = Date.now() - ini;
  return rel;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // quem pode disparar: o agendador (segredo do Vault) ou um administrador logado no painel
  let autorizado = false;
  const segredo = req.headers.get("x-sync-secret");
  if (segredo) autorizado = !!(await sb.rpc("site_sync_segredo_ok", { p: segredo })).data;
  else {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = token ? await sb.auth.getUser(token) : { data: null };
    const email = u?.user?.email?.toLowerCase();
    if (email) autorizado = !!(await sb.from("site_admins").select("email").ilike("email", email).maybeSingle()).data;
  }
  if (!autorizado) return json({ erro: "não autorizado" }, 401);
  const corpo = await req.json().catch(() => ({}));
  const tarefa = trabalhar(sb).catch(e => ({ erro: String(e?.message || e) }));
  if (corpo?.esperar) return json(await tarefa);
  // @ts-ignore EdgeRuntime existe no Supabase
  EdgeRuntime.waitUntil(tarefa);
  return json({ ok: true, iniciado: true }, 202);
});
