// Rumo à Posse · sincroniza a aba "Concursos" com o Qconcursos Folha Dirigida.
// Lê as páginas-resumo das carreiras Tribunais, Fiscal e Controle, extrai o bloco
// "Órgão / Status / Banca / Cargos / Vagas / Escolaridade / Salário" de cada concurso
// e atualiza a tabela site_concursos (somente linhas com origem = 'folha').
// Roda todo dia pelo pg_cron. Linhas cadastradas à mão no painel não são tocadas.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const FONTES = [
  { area: "Tribunais", url: "https://folha.qconcursos.com/n/concursos-tribunais" },
  { area: "Fiscal",    url: "https://folha.qconcursos.com/n/concursos-fiscais" },
  { area: "Controle",  url: "https://folha.qconcursos.com/n/concursos-controle" },
];

// ---- PARSER (início) ----
const ENT = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", ordm:"º", ordf:"ª", ndash:"–", mdash:"—" };
function decodificar(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => {
    if (c[0] === "#") return String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    return ENT[c.toLowerCase()] ?? m;
  });
}

// HTML -> linhas de texto. Títulos viram "## ", links da Folha viram "[[url]]".
function paraLinhas(html) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const ini = h.search(/<h1[\s>]/i);
  if (ini > 0) h = h.slice(ini);
  const fim = h.search(/Coment[áa]rios|Not[íi]cias mais lidas/i);
  if (fim > 0) h = h.slice(0, fim);
  h = h
    .replace(/<a\s[^>]*href="((?:https:\/\/folha\.qconcursos\.com)?\/[ne]\/[a-z0-9-]+)[^"]*"[^>]*>/gi, (_, u) => ` [[${u.startsWith("/") ? "https://folha.qconcursos.com" + u : u}]] `)
    .replace(/<h[2-4][^>]*>/gi, "\n## ")
    .replace(/<\/(h[1-6]|p|li|div|ul|ol|section|article|blockquote|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodificar(h).split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const ROTULOS = [
  ["orgao", /^(órgão|orgão|instituto|instituição)\s*:/i],
  ["status", /^(status|situação\s*atual|situaçãoatual|situação)\s*:/i],
  ["banca", /^banca\s*:/i],
  ["cargo", /^(cargos?|áreas?)\s*:/i],
  ["vagas", /^vagas\s*:/i],
  ["escolaridade", /^escolaridade\s*:/i],
  ["salario", /^(salários?|remuneração|remunerações|salário inicial[^:]*|vencimentos?)\s*:/i],
  ["inscricoes", /^inscrições\s*:/i],
  ["provas", /^provas?\s*:/i],
];
function rotulo(l) {
  for (const [k, re] of ROTULOS) if (re.test(l)) return [k, l.replace(re, "").replace(/\[\[[^\]]+\]\]/g, "").trim().replace(/\.$/, "")];
  return null;
}

function extrair(html) {
  const linhas = paraLinhas(html), blocos = [];
  let titulo = "", atual = null;
  const fechar = () => { if (atual && atual.orgao) blocos.push(atual); atual = null; };
  for (const l of linhas) {
    if (l.startsWith("## ")) { fechar(); titulo = l.slice(3).replace(/\[\[[^\]]+\]\]/g, "").trim(); continue; }
    const r = rotulo(l);
    if (r && r[0] === "orgao") { fechar(); atual = { titulo, orgao: r[1] }; continue; }
    if (r && atual) { if (!(r[0] in atual)) atual[r[0]] = r[1]; continue; }
    if (atual) {
      const link = l.match(/\[\[([^\]]+)\]\]/);
      if (link && !atual.fonte_url) atual.fonte_url = link[1];
    }
  }
  fechar();
  return blocos;
}

const MESES = { janeiro:0, fevereiro:1, "março":2, marco:2, abril:3, maio:4, junho:5, julho:6, agosto:7, setembro:8, outubro:9, novembro:10, dezembro:11 };
function datasInscricao(txt, hoje) {
  // "28 de outubro a 10 de dezembro de 2026" | "até 5 de novembro de 2026" | "26 de agosto a 17 de setembro"
  const ds = [...String(txt || "").toLowerCase().matchAll(/(\d{1,2})º?\s+de\s+([a-zç]+)(?:\s+de\s+(\d{4}))?/g)]
    .filter(m => m[2] in MESES).map(m => ({ d: +m[1], m: MESES[m[2]], a: m[3] ? +m[3] : null }));
  if (!ds.length) return null;
  const anoFim = ds[ds.length - 1].a ?? hoje.getFullYear();
  const mk = (x, anoPadrao) => new Date(Date.UTC(x.a ?? anoPadrao, x.m, x.d, 23, 59));
  const fim = mk(ds[ds.length - 1], anoFim);
  let ini = ds.length > 1 ? mk(ds[0], anoFim) : null;
  if (ini && ini > fim) ini = mk(ds[0], anoFim - 1);
  return { ini, fim, soFim: /até/.test(String(txt).toLowerCase()) || ds.length === 1 };
}

function situacao(b, hoje) {
  const s = (b.status || "").toLowerCase();
  const insc = datasInscricao(b.inscricoes, hoje);
  const publicado = /edita(l|is) publicad|inscriç(ões|ão) abert|publicado|aberto/.test(s);
  if (publicado) {
    if (insc && hoje <= insc.fim && (!insc.ini || hoje >= new Date(insc.ini.getTime() - 86400000))) return "aberto";
    if (/inscriç(ões|ão) abert/.test(s) && !insc) return "aberto";
    return "edital";
  }
  if (/autoriza|aprovad|banca (contratada|definida|escolhida)|contrata(ção|da) d[ae] banca|contrato assinado|confirmad/.test(s)) return "autorizado";
  return "previsto";
}

const cap = s => { s = String(s || "").trim().replace(/\.$/, ""); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
const valor = s => /^(não definid|nao definid|indefinid|a definir)/i.test(String(s || "").trim()) ? "A definir" : cap(s);
function escolaridade(t) {
  const s = (t || "").toLowerCase();
  const m = /médio/.test(s), sup = /superior/.test(s), tec = /técnic/.test(s);
  if (m && sup) return "Médio e Superior";
  if (sup) return "Superior";
  if (m) return tec ? "Técnico" : "Médio";
  return "A definir";
}
function banca(t) {
  const s = cap(t);
  return !s || /^(a definir|não definida|indefinida|em definição)/i.test(s) ? "A definir" : s;
}
function sigla(titulo, orgao) {
  const t = String(titulo || "").replace(/^concursos?\s+/i, "").trim();
  return t && t.length <= 40 ? t : orgao;
}
function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function paraLinha(b, area, paginaFonte, hoje) {
  const orgaoCurto = sigla(b.titulo, b.orgao);
  const cargo = valor(b.cargo) || "A definir";
  return {
    chave: `folha:${slug(area)}:${slug(orgaoCurto)}:${slug(cargo).slice(0, 60)}`,
    origem: "folha",
    area,
    orgao: orgaoCurto,
    orgao_nome: b.orgao,
    cargo,
    situacao: situacao(b, hoje),
    status_fonte: cap(b.status),
    vagas: valor(b.vagas) || "A definir",
    salario: valor(b.salario) || "A definir",
    banca: banca(b.banca),
    escolaridade: escolaridade(b.escolaridade),
    inscricoes: valor(b.inscricoes),
    provas: valor(b.provas),
    link_edital: "",
    fonte_url: b.fonte_url || paginaFonte,
    // "publicado" não é enviado: novos entram publicados (padrão do banco) e,
    // se você despublicar um no painel, ele continua escondido nas próximas atualizações
  };
}
// ---- PARSER (fim) ----

const PRIORIDADE = { aberto: 0, edital: 1, autorizado: 2, previsto: 3 };

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // só o agendador (que conhece o segredo guardado no Vault) pode disparar
  const { data: ok } = await sb.rpc("site_sync_segredo_ok", { p: req.headers.get("x-sync-secret") ?? "" });
  if (!ok) return new Response("não autorizado", { status: 401 });

  const hoje = new Date();
  const relatorio: Record<string, unknown> = {};
  const todas: ReturnType<typeof paraLinha>[] = [];
  const areasOk: string[] = [];

  for (const f of FONTES) {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "RumoAPosseBot/1.0 (+https://maycon22.github.io/rumo-a-posse/)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blocos = extrair(await r.text());
      if (blocos.length < 2) throw new Error(`só ${blocos.length} concurso(s) encontrado(s); formato da página pode ter mudado`);
      const vistos = new Map<string, string>();
      for (const b of blocos) {
        const l = paraLinha(b, f.area, f.url, hoje);
        const { fonte_url: _f, ...semLink } = b;
        const assinatura = JSON.stringify(semLink);
        if (vistos.get(l.chave) === assinatura) continue;          // bloco repetido na página
        let n = 2; const base = l.chave;
        while (vistos.has(l.chave)) l.chave = `${base}-${n++}`;    // mesmo órgão/cargo, concurso diferente
        vistos.set(l.chave, assinatura); todas.push(l);
      }
      areasOk.push(f.area);
      relatorio[f.area] = vistos.size;
    } catch (e) {
      relatorio[f.area] = `erro: ${(e as Error).message}`;   // mantém os dados anteriores dessa área
    }
  }

  todas.sort((a, b) => PRIORIDADE[a.situacao] - PRIORIDADE[b.situacao] || a.area.localeCompare(b.area) || a.orgao.localeCompare(b.orgao));
  todas.forEach((l, i) => Object.assign(l, { ordem: 100 + i }));

  if (todas.length) {
    const { error } = await sb.from("site_concursos").upsert(todas, { onConflict: "chave" });
    if (error) return Response.json({ erro: error.message, relatorio }, { status: 500 });
  }
  // remove concursos que saíram da fonte (só das áreas lidas com sucesso)
  if (areasOk.length) {
    const atuais = todas.map(l => l.chave);
    let q = sb.from("site_concursos").delete().eq("origem", "folha").in("area", areasOk);
    if (atuais.length) q = q.not("chave", "in", `(${atuais.map(c => `"${c}"`).join(",")})`);
    const { error } = await q;
    if (error) return Response.json({ erro: error.message, relatorio }, { status: 500 });
  }
  await sb.from("site_config").upsert({ chave: "concursos_sincronizado_em", valor: hoje.toISOString() });
  return Response.json({ ok: true, total: todas.length, relatorio });
});
