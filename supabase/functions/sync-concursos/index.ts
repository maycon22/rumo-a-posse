// Rumo à Posse · sincroniza a aba "Concursos" com o Qconcursos Folha Dirigida.
// Lê as páginas-resumo das carreiras Tribunais, Fiscal e Controle, extrai o bloco
// "Órgão / Status / Banca / Cargos / Vagas / Escolaridade / Salário" de cada concurso
// e atualiza a tabela site_concursos (somente linhas com origem = 'folha').
// Roda todo dia pelo pg_cron. Linhas cadastradas à mão no painel não são tocadas.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extrairDetalhes, acharMateria, lerIndice } from "./detalhes.ts";

const SITEMAPS = ["https://folha.qconcursos.com/sitemaps/news1.xml.gz", "https://folha.qconcursos.com/daily_sitemap.xml.gz"];

// Usa o resumo da matéria (mais recente que a página-resumo) para atualizar campos defasados
function atualizarComFicha(l, ficha, hoje) {
  const pega = (re) => (ficha.find(f => re.test(f.rotulo)) || {}).valor || "";
  const patch: Record<string, string> = {};
  const status = pega(/^(situa[çc][ãa]o( atual)?|status)$/i);
  const insc = pega(/^inscri[çc][õo]es$/i);
  const provas = pega(/^(provas?|data das? provas?|data da prova objetiva)$/i);
  const bancaF = pega(/^banca( organizadora)?$/i);
  const vagas = pega(/^vagas$/i), rem = pega(/^(remunera[çc][ãa]o( inicial)?|sal[áa]rios?( inicial)?)$/i);
  if (insc && l.inscricoes === "A definir" || insc && !l.inscricoes) patch.inscricoes = cap(insc);
  if (provas && (!l.provas || l.provas === "A definir")) patch.provas = cap(provas);
  if (bancaF && l.banca === "A definir" && !/defini/i.test(bancaF)) patch.banca = banca(bancaF);
  if (vagas && l.vagas === "A definir") patch.vagas = valor(vagas);
  if (rem && l.salario === "A definir") patch.salario = valor(rem);
  if (status) {
    const nova = situacao({ status, inscricoes: patch.inscricoes || l.inscricoes }, hoje);
    if (PRIORIDADE[nova] < PRIORIDADE[l.situacao] || !l.status_fonte) { patch.situacao = nova; patch.status_fonte = cap(status); }
  }
  return patch;
}

// id: entra no endereço do concurso (não muda); area: nome exibido no site.
// A ordem define a prioridade quando o mesmo órgão aparece em duas áreas (fica na mais específica).
const FONTES = [
  { id: "tribunais",      area: "Tribunal",          url: "https://folha.qconcursos.com/n/concursos-tribunais" },
  { id: "fiscal",         area: "Fiscal",            url: "https://folha.qconcursos.com/n/concursos-fiscais" },
  { id: "controle",       area: "Controle e Gestão", url: "https://folha.qconcursos.com/n/concursos-controle" },
  { id: "policial",       area: "Policial",          url: "https://folha.qconcursos.com/n/concursos-policiais" },
  { id: "bancaria",       area: "Bancária",          url: "https://folha.qconcursos.com/n/concursos-bancarios" },
  { id: "legislativa",    area: "Legislativa",       url: "https://folha.qconcursos.com/n/concursos-legislativo" },
  { id: "administrativa", area: "Administrativa",    url: "https://folha.qconcursos.com/n/concursos-administrativos" },
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
  const publicado = /edita(l|is) publicad|inscriç(ões|ão) (abert|encerrad)|publicado|aberto|encerrad|homologad|gabarito/.test(s);
  if (publicado) {
    if (insc && hoje <= insc.fim && (!insc.ini || hoje >= new Date(insc.ini.getTime() - 86400000))) return "aberto";
    if (/inscriç(ões|ão) abert/.test(s) && !insc) return "aberto";
    return "edital";
  }
  if (/autoriza|aprovad|banca (contratada|definida|escolhida)|contrata(ção|da) d[ae] banca|contrato assinado|confirmad/.test(s)) return "autorizado";
  return "previsto";
}

const cap = s => { s = String(s || "").trim().replace(/\.$/, ""); return s ? s[0].toUpperCase() + s.slice(1) : ""; };
const valor = s => /^(não definid|nao definid|indefinid|a definir|a confirmar|não informad|nao informad)/i.test(String(s || "").trim()) ? "A definir" : cap(s);
function escolaridade(t) {
  const s = (t || "").toLowerCase();
  const m = /médio/.test(s), sup = /superior/.test(s), tec = /técnic/.test(s);
  if (m && sup) return "Médio e Superior";
  if (sup) return "Superior";
  if (m) return tec ? "Técnico" : "Médio";
  return "A definir";
}
function banca(t) {
  const s = cap(String(t || "").split(/[;,]\s| \(com /)[0]);
  return !s || /^(a definir|a confirmar|não definida|indefinida|em definição|em processo|em escolha|não informad)/i.test(s) ? "A definir" : s;
}
function sigla(titulo, orgao) {
  const t = String(titulo || "").replace(/^(resumo d[oa]s?\s+)?(novo\s+)?concursos?\s+/i, "").trim();
  return t && t.length <= 40 ? t : orgao;
}
function slug(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// link específico do concurso (matéria "concurso-..." ou página do órgão); links para outras páginas-resumo não servem
const fonteBoa = (u) => !!u && (/\/e\/[a-z0-9-]+$/.test(u) || /\/n\/concurso-[a-z0-9-]+$/.test(u)) && !/como-estudar|guia|gratis|caderno|questoes/.test(u);
function paraLinha(b, area, paginaFonte, hoje, id = slug(area)) {
  const orgaoCurto = sigla(b.titulo, b.orgao);
  const cargo = valor(b.cargo) || "A definir";
  return {
    chave: `folha:${id}:${slug(orgaoCurto)}:${slug(cargo).slice(0, 60)}`,
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
    fonte_url: fonteBoa(b.fonte_url) ? b.fonte_url : paginaFonte,
    // "publicado" não é enviado: novos entram publicados (padrão do banco) e,
    // se você despublicar um no painel, ele continua escondido nas próximas atualizações
  };
}
// ---- PARSER (fim) ----

// ---- LINKS DAS BANCAS (início) ----
// Só para concursos com edital publicado. FCC e Cebraspe têm listas públicas lidas direto do site da banca.
// Para as demais, usa o link da matéria da Folha quando ele aponta para a página do concurso na banca.
// A Vunesp bloqueia acesso automatizado: os links dela são cadastrados à mão e não são apagados aqui.
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ª/g, "a").replace(/º/g, "o")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const UA = { "User-Agent": "RumoAPosseBot/1.0 (+https://maycon22.github.io/rumo-a-posse/)" };
const DOMINIOS_BANCA = /(^|\.)(vunesp\.com\.br|concursosfcc\.com\.br|cebraspe\.org\.br|fgv\.br|cesgranrio\.org\.br|ibfc\.org\.br|institutoaocp\.org\.br|idecan\.org\.br|quadrix\.org\.br|consulplan\.net|ibade\.org\.br|fundatec\.org\.br|iades\.com\.br|selecon\.org\.br|avalia\.org\.br|ibam-concursos\.org\.br|institutoconsulplan\.org\.br|fepese\.org\.br|objetivas\.com\.br|legalleconcursos\.com\.br|institutoibest\.org\.br|cetrede\.com\.br|funcab\.org|ufpr\.br|fundep\.ufmg\.br|amauc\.org\.br|cs\.ufgd\.edu\.br|institutoaccess\.org\.br|cetapnet\.com\.br|seletiva\.org\.br)$/i;
const GENERICOS = /inscricaoaberta|inscricoesabertas|andamento|proximos|\/busca|\/$|index\.php$/i;

async function listaFCC() {
  const out: { nome: string; url: string }[] = [];
  for (const p of ["concursoInscricaoAberta", "concursoAndamento", "concursoProximo"]) {
    try {
      const r = await fetch(`https://www.concursosfcc.com.br/${p}.html`, { headers: UA });
      const html = new TextDecoder("iso-8859-1").decode(await r.arrayBuffer());
      for (const m of html.matchAll(/textoInstituicao2">\s*<a href="(https:\/\/www\.concursosfcc\.com\.br\/concursos\/[a-z0-9]+\/index\.html)">([^<]+)</g))
        out.push({ url: m[1], nome: decodificar(m[2]) });
    } catch (_) { /* lista indisponível: segue sem ela */ }
  }
  return out;
}
async function listaCebraspe() {
  try {
    const r = await fetch("https://apis.cebraspe.org.br/cebraspe/eventos/tipo/concursos/", { headers: UA });
    const fases = await r.json();
    return fases.filter(f => !/encerrad/i.test(f.faseEvento)).flatMap(f => f.eventos.map(e => ({
      codigo: String(e.eventoURL || ""), nome: String(e.eventoNomeAbreviado || ""), ano: +e.eventoAno || 0,
      url: `https://www.cebraspe.org.br/concursos/${e.eventoURL}`
    })));
  } catch (_) { return []; }
}
async function linksDaMateria(url) {
  if (!/\/n\//.test(url)) return [];
  try {
    const html = await (await fetch(url, { headers: UA })).text();
    const achados = new Set<string>();
    for (const m of html.replace(/<script[\s\S]*?<\/script>/gi, "").matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
      try {
        const u = new URL(decodificar(m[1]));
        if (DOMINIOS_BANCA.test(u.hostname) && !GENERICOS.test(u.pathname + u.search) && u.pathname.length > 1) achados.add(u.href);
      } catch (_) { /* link inválido */ }
    }
    return [...achados].slice(0, 3);
  } catch (_) { return []; }
}

async function linksBanca(l, fcc, ceb) {
  const banca = norm(l.banca), nome = norm(l.orgao_nome), sig = norm(l.orgao);
  const rot = (u) => ({ rotulo: `Página do concurso na ${l.banca}`, url: u });
  if (/fcc|carlos chagas/.test(banca) && nome) {
    const achou = [...new Map(fcc.filter(x => { const n = norm(x.nome); return n === nome || n.includes(nome) || nome.includes(n); }).map(x => [x.url, x])).values()];
    if (achou.length) return achou.slice(0, 3).map(x => rot(x.url));
  }
  if (/cebraspe|cespe/.test(banca) && sig) {
    const prefixo = sig.toUpperCase().replace(/ /g, "_") + "_";
    const cargo = norm(l.cargo);
    const achou = ceb.filter(e => e.codigo.toUpperCase().startsWith(prefixo))
      .filter(e => !/NOTARI|CONSELHEIRO|RESIDENCIA/i.test(e.codigo) || /notari|conselheiro|residencia/.test(cargo))
      .sort((a, b) => b.ano - a.ano);
    if (achou.length) {
      const ano = achou[0].ano;
      return achou.filter(e => e.ano === ano).slice(0, 3).map(e => ({ rotulo: `Página do concurso no Cebraspe (${e.nome})`, url: e.url }));
    }
  }
  const daMateria = await linksDaMateria(l.materia_url || l.fonte_url);
  return daMateria.map(rot);
}
// ---- LINKS DAS BANCAS (fim) ----

const PRIORIDADE = { aberto: 0, edital: 1, autorizado: 2, previsto: 3 };

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // só o agendador (que conhece o segredo guardado no Vault) pode disparar
  const { data: ok } = await sb.rpc("site_sync_segredo_ok", { p: req.headers.get("x-sync-secret") ?? "" });
  if (!ok) return new Response("não autorizado", { status: 401 });

  const hoje = new Date();
  const relatorio: Record<string, unknown> = {};
  const todas = [];
  const areasOk: string[] = [];

  await Promise.all(FONTES.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blocos = extrair(await r.text());
      if (blocos.length < 2) throw new Error(`só ${blocos.length} concurso(s) encontrado(s); formato da página pode ter mudado`);
      const vistos = new Map<string, string>();
      for (const b of blocos) {
        const l = paraLinha(b, f.area, f.url, hoje, f.id);
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
  }));

  // mesmo órgão em duas áreas: fica na mais específica (ordem de FONTES) e herda o que a outra sabia a mais
  const ordemArea = (a) => FONTES.findIndex(f => f.area === a);
  const porOrgao = new Map();
  const unicas = [];
  for (const l of [...todas].sort((a, b) => ordemArea(a.area) - ordemArea(b.area))) {
    const k = slug(l.orgao);
    const ja = porOrgao.get(k);
    if (!ja) { porOrgao.set(k, l); unicas.push(l); continue; }
    if (ja.area === l.area) { unicas.push(l); continue; }              // dois concursos do mesmo órgão na mesma área
    for (const c of ["banca", "vagas", "salario", "inscricoes", "provas", "cargo", "escolaridade"])
      if ((!ja[c] || ja[c] === "A definir") && l[c] && l[c] !== "A definir") ja[c] = l[c];
    if (PRIORIDADE[l.situacao] < PRIORIDADE[ja.situacao]) { ja.situacao = l.situacao; ja.status_fonte = l.status_fonte; }
    if (!ja.status_fonte && l.status_fonte) ja.status_fonte = l.status_fonte;
    if (ja.fonte_url.includes("/n/concursos-") && !l.fonte_url.includes("/n/concursos-")) ja.fonte_url = l.fonte_url;
  }
  relatorio.duplicados_unidos = todas.length - unicas.length;
  todas.length = 0; todas.push(...unicas);

  todas.sort((a, b) => PRIORIDADE[a.situacao] - PRIORIDADE[b.situacao] || ordemArea(a.area) - ordemArea(b.area) || a.orgao.localeCompare(b.orgao));
  todas.forEach((l, i) => Object.assign(l, { ordem: 100 + i }));

  if (todas.length) {
    const { error } = await sb.from("site_concursos").upsert(todas, { onConflict: "chave" });
    if (error) return Response.json({ erro: error.message, relatorio }, { status: 500 });
  }
  // remove concursos que saíram da fonte (só das áreas lidas com sucesso)
  if (areasOk.length) {
    const atuais = todas.map(l => l.chave);
    const ids = FONTES.filter(f => areasOk.includes(f.area)).map(f => f.id);
    let q = sb.from("site_concursos").delete().eq("origem", "folha").or(ids.map(id => `chave.like.folha:${id}:*`).join(","));
    if (atuais.length) q = q.not("chave", "in", `(${atuais.map(c => `"${c}"`).join(",")})`);
    const { error } = await q;
    if (error) return Response.json({ erro: error.message, relatorio }, { status: 500 });
  }
  // ficha completa: fatos da matéria principal de cada concurso (5 por vez)
  const paginas = new Map<string, Promise<string>>();
  const buscar = (u: string) => {
    if (!paginas.has(u)) paginas.set(u, fetch(u, { headers: UA }).then(r => r.ok ? r.text() : "").catch(() => ""));
    return paginas.get(u)!;
  };
  const indice = await lerIndice(SITEMAPS, async (u) => {
    try { const r = await fetch(u, { headers: UA }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch (_) { return null; }
  });
  relatorio.indice_materias = indice.length;
  let comDetalhes = 0, corrigidos = 0;
  for (let i = 0; i < todas.length; i += 8) {
    await Promise.all(todas.slice(i, i + 8).map(async (l) => {
      try {
        const materia = acharMateria(l.fonte_url, l.orgao, l.cargo, l.situacao, indice, hoje);
        if (!materia) return;
        const html = await buscar(materia);
        if (!html) return;
        const d = extrairDetalhes(html, materia);
        if (!d.ficha.length && !d.secoes.length) return;           // nada útil: mantém o que já havia
        const patch = atualizarComFicha(l, d.ficha, hoje);
        if (Object.keys(patch).length) { corrigidos++; Object.assign(l, patch); }
        l.materia_url = materia;
        await sb.from("site_concursos").update({ ...patch, detalhes: { ...d, lido_em: hoje.toISOString() } }).eq("chave", l.chave);
        comDetalhes++;
      } catch (_) { /* segue para o próximo */ }
    }));
  }
  relatorio.com_detalhes = comDetalhes;
  relatorio.atualizados_pela_materia = corrigidos;

  // links das bancas para concursos com edital publicado
  const comEdital = todas.filter(l => l.situacao === "aberto" || l.situacao === "edital");
  const links: Record<string, number> = {};
  if (comEdital.length) {
    const [fcc, ceb] = await Promise.all([listaFCC(), listaCebraspe()]);
    await Promise.all(comEdital.map(async (l) => {
      const achados = await linksBanca(l, fcc, ceb);
      links[l.orgao] = achados.length;
      // sem resultado, mantém o que já estava (ex.: links da Vunesp cadastrados à mão)
      if (achados.length) await sb.from("site_concursos").update({ links_banca: achados }).eq("chave", l.chave);
    }));
  }
  relatorio.links_banca = links;


  await sb.from("site_config").upsert({ chave: "concursos_sincronizado_em", valor: hoje.toISOString() });
  return Response.json({ ok: true, total: todas.length, relatorio });
});
