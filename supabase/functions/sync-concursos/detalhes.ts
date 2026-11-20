// Rumo à Posse · extrai FATOS de uma matéria de concurso (listas, tabelas, valores e datas).
// Não guarda parágrafos: só itens curtos e objetivos, organizados em categorias próprias do site.
// Funciona em Deno (Edge Function) e em Node 22+ (teste local).

const ENT_D: Record<string, string> = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", ordm:"º", ordf:"ª", ndash:"–", mdash:"—", hellip:"…" };
function dec(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) => {
    if (c[0] === "#") return String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10));
    return ENT_D[c.toLowerCase()] ?? m;
  });
}
const txt = (h: string) => dec(h.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
function limpaItem(s: string) {
  s = s.replace(/\s*[;,]?(?:\s+(?:e|ou))?\s*[;.]?\s*$/i, "").replace(/[;:,]$/, "").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
function tituloCurto(t: string) {
  let s = t.replace(/[?:!]$/, "").replace(/^(saiba|veja|entenda|confira|conhe[çc]a)\s+/i, "")
    .replace(/^(como|quais|qual|quanto|quando) (ser[áa]o?|s[ãa]o|[ée]|v[ãa]o ser) (a |o |as |os )?/i, "")
    .replace(/\s+(do|da|no|na|para o|para a) (novo )?concurso\b.*$/i, "")
    .replace(/\s+(do|da|no|na)\s+[A-Z][A-Za-z0-9]{1,8}(\s[A-Z]{2})?$/, "").trim();
  // títulos com cara de manchete (frases da matéria) não são usados
  if (/^concurso\b/i.test(s) || /\b(ter[áa]|oferece|publica|divulga|abre|sai|poder[ãa]o|tem)\b/i.test(s) || s.length > 50) return "";
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

type Token = { t: "h2" | "h3" | "li" | "p" | "table"; text?: string; rows?: string[][] };

function tokens(html: string): Token[] {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<svg[\s\S]*?<\/svg>/gi, "");
  const ini = h.search(/<h1[\s>]/i); if (ini > 0) h = h.slice(ini);
  const fim = h.search(/Coment[áa]rios<|Not[íi]cias mais lidas|Not[íi]cias relacionadas/i); if (fim > 0) h = h.slice(0, fim);
  const out: Token[] = [];
  const re = /<table[\s\S]*?<\/table>|<(h[2-4]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of h.matchAll(re)) {
    if (m[0].toLowerCase().startsWith("<table")) {
      const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)]
        .map(r => [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => txt(c[1])))
        .filter(r => r.some(Boolean));
      if (rows.length) out.push({ t: "table", rows });
      continue;
    }
    const tag = m[1].toLowerCase(), text = txt(m[2]);
    if (!text) continue;
    out.push({ t: tag === "h2" ? "h2" : tag.startsWith("h") ? "h3" : (tag === "li" ? "li" : "p"), text });
  }
  return out;
}

const CATEGORIAS: [string, string, RegExp][] = [
  ["datas", "Datas importantes", /\bdatas\b|cronograma|calend[áa]rio|pr[óo]ximas etapas/i],
  ["cargos", "Cargos, vagas e especialidades", /cargo|vaga|especialidad|lota[cç]|carreira|cadastro de reserva|[áa]reas?\b/i],
  ["requisitos", "Requisitos", /requisito|escolaridade|exig/i],
  ["remuneracao", "Remuneração e benefícios", /sal[áa]rio|remunera|benef[íi]cio|ganh/i],
  ["inscricao", "Inscrição e taxa", /inscri|isen[cç]|redu[cç][ãa]o da taxa|taxa/i],
  ["etapas", "Etapas da seleção", /etapa|fase|como ser[áa] a sele/i],
  ["prova", "Como é a prova", /prova|conte[úu]do|disciplina|mat[ée]ria|discursiva|reda[cç][ãa]o|o que (cai|estudar)|conhecimentos (gerais|b[áa]sicos|espec[íi]ficos|complementares)/i],
  ["taf", "Teste físico", /\btaf\b|aptid[ãa]o f|f[íi]sic/i],
];
const IGNORAR = /sum[áa]rio|[úu]ltimas not[íi]cias|cronologia|caderno|assista|v[íi]deo|leia tamb|veja tamb|o que faz|como estudar|prepare|material|\bcursos?\b|desafio|[úu]ltima prova|quest[õo]es (da|de) prova/i;
const ROTULO = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ú ]{2,28}):\s*(.{1,180})$/;

export type Detalhes = {
  materia_url?: string; edital_url?: string; ficha: { rotulo: string; valor: string }[];
  secoes: { id: string; titulo: string; grupos: { titulo: string; itens: string[] }[]; tabelas: { linhas: string[][] }[] }[];
  salarios: { cargo: string; valor: string }[]; beneficios: { nome: string; valor: string }[];
  isencao?: { tipo: string; periodo?: string; publico: string[] }; questoes?: string; validade?: string; jornada?: string;
};

export function extrairDetalhes(html: string, url: string): Detalhes {
  const tk = tokens(html);
  const d: Detalhes = { materia_url: url, ficha: [], secoes: [], salarios: [], beneficios: [] };

  // link do edital (PDF, Diário Oficial ou site da banca)
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = dec(m[1]), t = txt(m[2]);
    if (/edital/i.test(t) && !/verticalizado/i.test(t) && /^https?:/i.test(href) && !/qconcursos\.com|hubspot/i.test(href) &&
        (/\.pdf($|\?)/i.test(href) || /in\.gov\.br|diariooficial|\bdoe\.|\bdje|cebraspe|concursosfcc|vunesp|fgv\.br|cesgranrio|ibfc|aocp|idecan|quadrix|consulplan|ibade|fundatec|iades|selecon/i.test(href))) {
      d.edital_url = href; break;
    }
  }

  // ficha: o primeiro bloco contínuo de "Rótulo: valor" com 3 ou mais linhas (o resumo da matéria)
  let bloco: { rotulo: string; valor: string }[] = [];
  for (const t of tk) {
    const m = (t.t === "li" || t.t === "p") && t.text ? t.text.match(ROTULO) : null;
    if (m && !/^(fonte|leia|veja|confira|acesse|clique|cupom)/i.test(m[1])) { bloco.push({ rotulo: m[1].trim(), valor: limpaItem(m[2]) }); continue; }
    if (bloco.length >= 3) break;
    bloco = [];
  }
  if (bloco.length >= 3) d.ficha = bloco.filter((x, i, a) => a.findIndex(y => y.rotulo.toLowerCase() === x.rotulo.toLowerCase()) === i);
  const fichaKeys = new Set(d.ficha.map(x => `${x.rotulo}: ${x.valor}`.toLowerCase()));

  // seções: listas e tabelas agrupadas pelas categorias do site
  let cat: [string, string, RegExp] | null = null, grupoTitulo = "", ultimoP = "";
  const secao = (id: string, titulo: string) => {
    let s = d.secoes.find(x => x.id === id);
    if (!s) { s = { id, titulo, grupos: [], tabelas: [] }; d.secoes.push(s); }
    return s;
  };
  const categoria = (texto: string) => CATEGORIAS.find(c => c[2].test(texto)) || null;
  for (const t of tk) {
    const texto = t.text || "";
    if (t.t === "h2") {
      cat = IGNORAR.test(texto) || /resumo/i.test(texto) ? null : categoria(texto);
      grupoTitulo = cat ? tituloCurto(texto) : "";
      if (grupoTitulo.length > 60) grupoTitulo = "";
      ultimoP = ""; continue;
    }
    if (t.t === "h3") {
      if (IGNORAR.test(texto) || /resumo/i.test(texto)) { cat = null; continue; }
      const c = texto.length <= 80 ? categoria(texto) : null; if (c && !cat) cat = c;
      grupoTitulo = texto.length <= 80 ? tituloCurto(texto) : ""; ultimoP = ""; continue;
    }
    if (t.t === "p") {
      // linha curta sem pontuação final antes de uma lista = nome do grupo (ex.: "Técnico Judiciário")
      ultimoP = texto.length <= 90 && !/[.!?:]$/.test(texto) && !/:\s*\S/.test(texto) && !/^►/.test(texto) ? texto : "";
      if (!cat && /:$/.test(texto) && /especialidade|cargos|vagas/i.test(texto)) cat = categoria(texto);
      continue;
    }
    if (!cat) continue;
    if (t.t === "table") {
      const linhas = t.rows!.slice(0, 40).map(r => r.slice(0, 6).map(c => c.slice(0, 140)));
      if (linhas.length >= 2) secao(cat[0], cat[1]).tabelas.push({ linhas });
      continue;
    }
    if (t.t === "li") {
      const item = limpaItem(texto);
      if (!item || item.length > 200 || fichaKeys.has(texto.toLowerCase().replace(/[;.]$/, "")) ||
          /\d+ª posi[çc][ãa]o/i.test(item) || /^(►|clique|acesse|baixe|confira)/i.test(item) || /^concurso [^:]{2,40}:/i.test(item)) continue;
      const titulo = ultimoP && !/^(veja|confira|conheça|são eles|entre eles)/i.test(ultimoP) && !/^concurso\b/i.test(ultimoP) ? ultimoP : grupoTitulo;
      // o nome do grupo pode indicar melhor a categoria (ex.: "Conhecimentos Gerais" -> prova; "Datas e etapas" -> datas)
      const catGrupo = titulo ? CATEGORIAS.filter(c => ["datas", "taf", "prova"].includes(c[0])).find(c => c[2].test(titulo)) : null;
      const efetiva = catGrupo || cat;
      const s = secao(efetiva[0], efetiva[1]);
      let g = s.grupos[s.grupos.length - 1];
      if (!g || g.titulo !== titulo) { g = { titulo, itens: [] }; s.grupos.push(g); }
      if (g.itens.length < 60 && !g.itens.includes(item)) g.itens.push(item);
    }
  }
  // junta grupos repetidos e remove os vazios
  d.secoes = d.secoes.map(s => {
    const grupos: { titulo: string; itens: string[] }[] = [];
    for (const g of s.grupos) {
      const ig = grupos.find(x => x.titulo === g.titulo && x.itens.join("|") === g.itens.join("|"));
      if (!ig && g.itens.length) grupos.push(g);
    }
    return { ...s, grupos };
  }).filter(s => s.grupos.length || s.tabelas.length);

  // fatos soltos no texto
  const corpo = tk.filter(t => t.t === "p" || t.t === "li").map(t => t.text!).join("\n");
  const vistoSal = new Set<string>();
  const reSal = /(R\$\s?[\d.]+,\d{2})\s+(?:para (?:o cargo de |os cargos de |a carreira de |o |os |a |as )?)([a-zçãâáéêíóôõú][a-zçãâáéêíóôõú ]{3,45}?)(?=[,.;)]| e (?:de )?R\$| e para|$)/gim;
  for (const m of corpo.matchAll(reSal)) {
    const cargo = limpaItem(m[2]), k = cargo.toLowerCase() + m[1];
    if (!vistoSal.has(k) && !/m[êe]s|\bano|\bdia|hora|inscri|taxa|isen/i.test(cargo)) { vistoSal.add(k); d.salarios.push({ cargo, valor: m[1].replace(/\s/g, "") }); }
  }
  const vistoBen = new Set<string>();
  const reBen = /((?:aux[íi]lio|assist[êe]ncia|vale|adicional|gratifica[çc][ãa]o|indeniza[çc][ãa]o)[- ][A-Za-zçãâáéêíóôõú-]+(?: [a-zçãâáéêíóôõú-]+)?)\s*\((?:de )?(R\$\s?[\d.]+(?:,\d{2})?)\)/gi;
  for (const m of corpo.matchAll(reBen)) {
    const nome = limpaItem(m[1]), k = nome.toLowerCase();
    if (!vistoBen.has(k)) { vistoBen.add(k); d.beneficios.push({ nome, valor: m[2].replace(/\s/g, "") }); }
  }
  const frIsen = corpo.split(/\n|(?<=\.)\s/).filter(s => /isen[çc][ãa]o|redu[çc][ãa]o (da|de) taxa|redu[çc][ãa]o de 50/i.test(s));
  if (frIsen.length) {
    const j = frIsen.join(" ");
    const publico: string[] = [];
    if (/cad[úu]nico|baixa renda|hipossufici/i.test(j)) publico.push("Inscritos no CadÚnico (baixa renda)");
    if (/medula/i.test(j)) publico.push("Doadores de medula óssea");
    if (/doador(es)? de sangue|doa[çc][ãa]o de sangue/i.test(j)) publico.push("Doadores de sangue");
    if (/estudante/i.test(j)) publico.push("Estudantes (regras no edital)");
    if (/desempregad|sal[áa]rios? m[íi]nimos?|remunera[çc][ãa]o inferior/i.test(j)) publico.push("Quem recebe até 2 salários mínimos ou está desempregado (regras no edital)");
    const per = j.match(/(?:entre os dias|dos dias|de)\s+(\d{1,2})º?(?: de ([a-zç]+))?\s+(?:e|a)\s+(\d{1,2})º? de ([a-zç]+)/i);
    d.isencao = {
      tipo: /redu[çc][ãa]o/i.test(j) && !/isen[çc][ãa]o/i.test(j) ? "Redução da taxa" : "Isenção da taxa",
      periodo: per ? `${per[1]}${per[2] ? " de " + per[2] : ""} a ${per[3]} de ${per[4]}` : undefined,
      publico,
    };
  }
  const q = corpo.match(/(\d{2,3})\s+quest[õo]es/i); if (q) d.questoes = q[1];
  const v = corpo.match(/validade de (\w+(?: \w+)?) anos?/i);
  if (v) d.validade = `${v[1]} ${/^(um|1)$/i.test(v[1]) ? "ano" : "anos"}${/prorrog/i.test(corpo) ? ", prorrogável por igual período" : ""}`;
  const jn = corpo.match(/jornada (?:de trabalho )?(?:ser[áa] |[ée] )?de (\d{1,2}) horas (semanais|di[áa]rias)/i);
  if (jn) d.jornada = `${jn[1]} horas ${jn[2].toLowerCase()}`;
  return d;
}

// Índice de matérias recentes da Folha (sitemap), para achar a matéria principal de cada concurso.
export type Indice = { url: string; slug: string; data: string }[];
export async function lerIndice(urls: string[], baixar: (u: string) => Promise<Uint8Array | null>): Promise<Indice> {
  const out: Indice = [];
  for (const u of urls) {
    const bytes = await baixar(u);
    if (!bytes) continue;
    let xml: string;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      xml = await new Response(ds).text();
    } else xml = new TextDecoder().decode(bytes);
    for (const m of xml.matchAll(/<loc>(https:\/\/folha\.qconcursos\.com\/n\/([a-z0-9-]+))<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g))
      out.push({ url: m[1], slug: m[2], data: m[3] || "" });
  }
  return out;
}

const OUTRO_CONCURSO = /juiz|magistratura|cartorio|notari|residencia|estagi|conselheiro|delegado|procurador|promotor|defensor|vestibular/;
const NAO_PRINCIPAL = /verticalizado|caderno|questoes|raio-x|guia|gratis|como-estudar|gabarito|resultado|recurso|locais-de-prova|cartao|convocac|nomeac|aprovados|inscritos|disciplinas|mais-cobrad|revisao|simulado|live|aula|cupom|assinatura|black-friday|plano-de-estudo|perfil|dicas|estudar|materias|bibliografia|ultima-prova/;

// Escolhe a matéria principal: o link específico da página-resumo, ou a mais recente do órgão no índice.
export function acharMateria(fonteUrl: string, sigla: string, cargo: string, situacao: string, indice: Indice, hoje: Date): string | null {
  const publicado = situacao === "aberto" || situacao === "edital";
  if (/\/n\/[a-z0-9-]+$/.test(fonteUrl) && !/\/n\/concursos-(tribunais|fiscais|controle)$/.test(fonteUrl)) return fonteUrl;
  const base = sigla.split(/\s+-\s+/)[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const prefixos = [base];
  const semUf = base.replace(/-(ac|al|am|ap|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)$/, "");
  if (semUf !== base && semUf.includes("-")) prefixos.push(semUf);
  const cargoN = cargo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const limite = new Date(hoje.getTime() - 240 * 86400000).toISOString();
  for (const p of prefixos) {
    const re = new RegExp(`^concurso-${p}(-|$)`);
    const cand = indice.filter(x => re.test(x.slug) && (!x.data || x.data >= limite) && !NAO_PRINCIPAL.test(x.slug) &&
      (!OUTRO_CONCURSO.test(x.slug) || OUTRO_CONCURSO.test(cargoN)) &&
      // concurso ainda sem edital: matérias de inscrição aberta seriam de outra seleção do mesmo órgão
      (publicado || !/inscricoes-abertas|edital-publicado|retificacao|inscricoes-\d{4}$/.test(x.slug)));
    if (!cand.length) continue;
    cand.sort((a, b) => b.data.localeCompare(a.data));
    if (publicado) {
      const principal = cand.find(x => new RegExp(`^concurso-${p}(-\\d{4})?-edital(-publicado|-\\d{4})?$`).test(x.slug))
        || cand.find(x => /edital-publicado|edital-\d{4}$|inscric/.test(x.slug))
        || cand.find(x => /edital/.test(x.slug));
      if (principal) return principal.url;
    }
    return cand[0].url;
  }
  return null;
}
