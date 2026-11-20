/* Rumo à Posse · site público
   O conteúdo vem do Supabase (editado pelo painel admin.html).
   - Guarda a última resposta no navegador e mostra na hora nas visitas seguintes.
   - A lista de artigos vem sem o texto completo; o texto é buscado ao abrir o artigo.
   - Artigos têm endereço próprio (?artigo=slug), que o Google indexa separadamente.
   Sem Supabase configurado, mostra o conteúdo de exemplo. */

let ARTIGOS = [], CONCURSOS = [], PRODUTOS = [], CFG = {};
let MODO_EXEMPLO = true, sb = null, primeiraRota = true;
const SITUACOES = {aberto:"Inscrições abertas", edital:"Edital publicado", autorizado:"Autorizado", previsto:"Previsto"};
const NOME_SITE = "Rumo à Posse";
const DESC_PADRAO = "Artigos práticos sobre como estudar para concursos, radar de editais e materiais de estudo. Do edital à posse.";
const BASE = location.origin + location.pathname;          // endereço canônico do site
const CACHE_KEY = "rap-cache-v2";
const COLS_ARTIGO = "slug,titulo,categoria,resumo,imagem_capa,minutos,data_publicacao";
const corpos = new Map();                                   // slug -> corpo (HTML)

const $ = s => document.querySelector(s);
const fmtData = d => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}) : "";
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const urlSegura = u => /^https?:\/\//i.test(String(u||"").trim()) ? String(u).trim() : "";
const corSegura = c => /^#[0-9a-f]{6}$/i.test(c||"") ? c : "#ffd93b";
const vazio = msg => `<p style="color:var(--muted)">${msg}</p>`;
const linkArtigo = slug => "?artigo=" + encodeURIComponent(slug);
const slugConcurso = c => c.chave ? c.chave.replace(/^folha:/,"").replace(/:/g,"-") : String(c.id || slug2(c.orgao+"-"+c.cargo));
const slug2 = t => String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const linkConcurso = c => "?concurso=" + encodeURIComponent(slugConcurso(c));

/* HTML dos artigos: sempre passa pelo DOMPurify. Se ele não carregar, mostra só o texto. */
if (window.DOMPurify) {
  DOMPurify.addHook("afterSanitizeAttributes", n => {
    if (n.tagName === "A" && /^https?:/i.test(n.getAttribute("href")||"") && !n.href.startsWith(location.origin)) {
      n.setAttribute("target","_blank"); n.setAttribute("rel","noopener noreferrer");
    }
    if (n.tagName === "IMG") { n.setAttribute("loading","lazy"); n.setAttribute("decoding","async"); }
  });
}
const limpa = html => window.DOMPurify
  ? DOMPurify.sanitize(html, {FORBID_TAGS:["style","form","input"], FORBID_ATTR:["style"]})
  : `<p>${esc(String(html||"").replace(/<[^>]+>/g," "))}</p>`;

/* ---------- Dados ---------- */
function lerCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY)); }catch(e){ return null; } }
function gravarCache(d){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(d)); }catch(e){} }
function aplicar(d){ ARTIGOS=d.artigos;
  CONCURSOS=(d.concursos||[]).map(c=>({...c, status_fonte:String(c.status_fonte||"").replace(/[\s;,.]+$/,"")})); PRODUTOS=d.produtos; CFG=d.config; MODO_EXEMPLO=!!d.exemplo; }

async function buscarSupabase(){
  const [a,k,p,g] = await Promise.all([
    sb.from("site_artigos").select(COLS_ARTIGO).eq("publicado",true).order("data_publicacao",{ascending:false}),
    sb.from("site_concursos").select("id,chave,status_fonte,links_banca,orgao,orgao_nome,area,cargo,situacao,vagas,salario,banca,escolaridade,inscricoes,provas,link_edital,fonte_url").eq("publicado",true).order("ordem").order("atualizado_em",{ascending:false}),
    sb.from("site_produtos").select("titulo,tipo,cor,imagem,preco,preco_antigo,itens,link_checkout").eq("publicado",true).order("ordem"),
    sb.from("site_config").select("chave,valor")
  ]);
  for (const r of [a,k,p,g]) if (r.error) throw r.error;
  return { artigos:a.data, concursos:k.data, produtos:p.data, config:Object.fromEntries(g.data.map(x=>[x.chave,x.valor])) };
}

function dadosExemplo(){
  const ex = window.DADOS_EXEMPLO;
  ex.artigos.forEach(a=>corpos.set(a.slug, a.corpo));
  return { artigos:ex.artigos, concursos:ex.concursos, produtos:ex.produtos, config:ex.config, exemplo:true };
}

async function buscarCorpo(slug){
  if (corpos.has(slug)) return corpos.get(slug);
  if (!sb) return null;
  const { data, error } = await sb.from("site_artigos").select("corpo").eq("slug",slug).eq("publicado",true).maybeSingle();
  if (error) throw error;
  if (data) corpos.set(slug, data.corpo);
  return data ? data.corpo : null;
}

/* ---------- Cartões ---------- */
function cardArtigo(a){
  const capa = urlSegura(a.imagem_capa)
    ? `<span class="thumb-wrap"><img class="thumb" src="${esc(urlSegura(a.imagem_capa))}" alt="" loading="lazy" decoding="async" width="640" height="360"></span>`
    : `<span class="thumb-wrap"><span class="thumb thumb-ph" aria-hidden="true"><span>${esc(a.categoria)}</span></span></span>`;
  return `<article class="card clicavel"><a class="stretch" href="${linkArtigo(a.slug)}">${capa}
    <span class="tag" style="margin-top:4px">${esc(a.categoria)}</span>
    <h3 style="margin-top:10px">${esc(a.titulo)}</h3></a>
    <p>${esc(a.resumo)}</p>
    <div class="meta"><time datetime="${esc(a.data_publicacao)}">${fmtData(a.data_publicacao)}</time><span>${esc(a.minutos)} min de leitura</span></div></article>`;
}
const novaAba = `<span class="sr-only"> (abre em nova aba)</span>`;
function linksConcurso(c){
  const edital = (linksDaBanca(c)[0] || {}).url;
  return [
    edital ? `<a href="${esc(edital)}" target="_blank" rel="noopener noreferrer">Banca${novaAba}</a>` : "",
    `<a class="link-detalhes" href="${linkConcurso(c)}">Detalhes<span class="sr-only"> do concurso ${esc(c.orgao)}</span></a>`
  ].filter(Boolean).join(" · ");
}
function cardConcurso(c){
  const links = linksConcurso(c);
  return `<div class="card clicavel conc-card">
    <div class="card-top"><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span>${c.area?`<span class="tag">${esc(c.area)}</span>`:""}</div>
    <h3 title="${esc(c.orgao_nome||"")}">${esc(c.orgao)}</h3><p>${esc(c.cargo)}</p>
    <div class="meta"><span>Vagas: ${esc(c.vagas)}</span><span>Banca: ${esc(c.banca)}</span></div>
    ${c.inscricoes && c.inscricoes!=="A definir" ? `<div class="meta"><span>Inscrições: ${esc(c.inscricoes)}</span></div>` : ""}
    ${links ? `<div class="conc-links">${links} <span aria-hidden="true">→</span></div>` : ""}</div>`;
}
function botaoCompra(link, rotulo, classe){
  return urlSegura(link)
    ? `<a class="btn ${classe}" href="${esc(urlSegura(link))}" target="_blank" rel="noopener">${rotulo}<span class="sr-only"> (abre em nova aba)</span></a>`
    : `<button class="btn ${classe}" type="button" data-sem-link>Em breve</button>`;
}
function cardProduto(p){
  const itens = String(p.itens||"").split("\n").map(s=>s.trim()).filter(Boolean);
  const img = urlSegura(p.imagem);
  return `<div class="card product">
    ${img
      ? `<img class="cover cover-img" src="${esc(img)}" alt="Capa: ${esc(p.titulo)}" loading="lazy" decoding="async">`
      : `<div class="cover" style="background:${corSegura(p.cor)}" aria-hidden="true">${esc(p.titulo)}</div>`}
    <span class="tag" style="align-self:flex-start">${esc(p.tipo)}</span>
    <h3>${esc(p.titulo)}</h3>
    <ul>${itens.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>
    <div class="buy"><span class="price">${p.preco_antigo?`<s><span class="sr-only">De </span>R$ ${esc(p.preco_antigo)}</s> <span class="sr-only">por </span>`:""}R$ ${esc(p.preco)}</span>
    ${botaoCompra(p.link_checkout, "Comprar", "small")}</div></div>`;
}

/* Ordem das carreiras na aba Concursos */
const AREAS_ORDEM = ["Tribunal","Fiscal","Controle e Gestão","Policial","Bancária","Legislativa","Administrativa"];
function ordemAreas(lista){
  const grupos = new Map();
  for(const c of lista){ const a = c.area || ""; if(!grupos.has(a)) grupos.set(a, []); grupos.get(a).push(c); }
  const pos = a => { const i = AREAS_ORDEM.indexOf(a); return i < 0 ? 99 : i; };
  return [...grupos].sort((x,y)=>pos(x[0])-pos(y[0]));
}

function filtros(el, opcoes, onPick, contar){
  let atual = "Todos";
  const render = () => {
    el.innerHTML = ["Todos",...opcoes].map(o=>{
      const n = contar ? contar(o) : null;
      return `<button type="button" class="chip" aria-pressed="${o===atual}" data-v="${esc(o)}">${esc(o)}${n!=null?` <span class="chip-n">${n}</span>`:""}</button>`;
    }).join("");
  };
  el.onclick = e => {
    const b = e.target.closest(".chip"); if(!b) return;
    atual = b.dataset.v; render(); onPick(atual);
    el.querySelector(`[data-v="${CSS.escape(atual)}"]`)?.focus();
  };
  render(); onPick(atual);
}

/* ---------- Render ---------- */
function renderTudo(){
  $("#home-articles").innerHTML = ARTIGOS.slice(0,3).map(cardArtigo).join("") || vazio("Nenhum artigo publicado ainda.");
  $("#home-concursos").innerHTML = CONCURSOS.slice(0,3).map(cardConcurso).join("") || vazio("Nenhum concurso cadastrado ainda.");
  $("#home-produtos").innerHTML = PRODUTOS.slice(0,3).map(cardProduto).join("") || vazio("Nenhum material à venda ainda.");
  $("#conc-notice").hidden = !MODO_EXEMPLO;

  filtros($("#art-filters"), [...new Set(ARTIGOS.map(a=>a.categoria))], cat=>{
    $("#all-articles").innerHTML = ARTIGOS.filter(a=>cat==="Todos"||a.categoria===cat).map(cardArtigo).join("") || vazio("Nenhum artigo nesta categoria.");
  });
  // três filtros combinados: carreira, situação e busca por texto; lista agrupada por carreira
  const fc = { area:"Todos", sit:"Todos", busca:"" };
  const semAcento = t => String(t||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
  const linhaConcurso = (c, mostrarArea) => {
    const links = linksConcurso(c);
    const insc = c.inscricoes && c.inscricoes!=="A definir" ? `<span class="sub">Inscrições: ${esc(c.inscricoes)}</span>` : "";
    return `<tr><th scope="row"><strong title="${esc(c.orgao_nome||"")}">${esc(c.orgao)}</strong>${mostrarArea && c.area?` <span class="tag">${esc(c.area)}</span>`:""}
      <span class="sub">${esc(c.cargo)}</span>${links ? `<span class="conc-links">${links}</span>` : ""}</th>
      <td><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span>${insc}</td>
      <td class="num">${esc(c.vagas)}</td><td class="num">${esc(c.salario)}</td>
      <td>${esc(c.banca)}</td><td>${esc(c.escolaridade)}</td></tr>`;
  };
  const tabela = () => {
    const termo = semAcento(fc.busca.trim());
    const lista = CONCURSOS.filter(c=>(fc.area==="Todos"||c.area===fc.area) && (fc.sit==="Todos"||SITUACOES[c.situacao]===fc.sit) &&
      (!termo || semAcento([c.orgao,c.orgao_nome,c.cargo,c.banca,c.area].join(" ")).includes(termo)));
    let html;
    if(fc.area === "Todos" && areas.length){
      // agrupado: cada carreira com cabeçalho e contagem
      html = ordemAreas(lista).map(([area, itens]) => `<tr class="grupo-area"><th colspan="6" scope="colgroup">
          <span>${esc(area || "Outros")}</span> <span class="grupo-n">${itens.length} concurso${itens.length>1?"s":""}</span></th></tr>
        ${itens.map(c=>linhaConcurso(c,false)).join("")}`).join("");
    } else html = lista.map(c=>linhaConcurso(c, fc.area==="Todos")).join("");
    $("#conc-body").innerHTML = html || `<tr><td colspan="6" style="color:var(--muted)">Nenhum concurso com esses filtros${termo?` para "${esc(fc.busca)}"`:""}.</td></tr>`;
    $("#conc-total").textContent = `${lista.length} de ${CONCURSOS.length} concurso(s)`;
  };
  const areas = AREAS_ORDEM.filter(a=>CONCURSOS.some(c=>c.area===a)).concat([...new Set(CONCURSOS.map(c=>c.area).filter(a=>a && !AREAS_ORDEM.includes(a)))]);
  $("#conc-areas").hidden = !areas.length;
  filtros($("#conc-areas"), areas, a=>{ fc.area=a; tabela(); }, a=>a==="Todos"?CONCURSOS.length:CONCURSOS.filter(c=>c.area===a).length);
  filtros($("#conc-filters"), Object.values(SITUACOES), s=>{ fc.sit=s; tabela(); }, s=>s==="Todos"?null:CONCURSOS.filter(c=>SITUACOES[c.situacao]===s).length);
  const busca = $("#conc-busca");
  if(busca){ busca.value = ""; busca.oninput = () => { fc.busca = busca.value; tabela(); }; }
  const sinc = CFG.concursos_sincronizado_em ? new Date(CFG.concursos_sincronizado_em) : null;
  $("#conc-fonte").innerHTML = areas.length
    ? `Fonte: <a href="https://folha.qconcursos.com/" target="_blank" rel="noopener noreferrer">Qconcursos Folha Dirigida${novaAba}</a>${sinc && !isNaN(sinc) ? `, atualizado em ${sinc.toLocaleDateString("pt-BR")} às ${sinc.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}` : ""}. Confirme sempre as datas e regras no edital oficial.`
    : "";
  filtros($("#prod-filters"), [...new Set(PRODUTOS.map(p=>p.tipo))], t=>{
    $("#all-produtos").innerHTML = PRODUTOS.filter(p=>t==="Todos"||p.tipo===t).map(cardProduto).join("") || vazio("Nenhum material nesta categoria.");
  });

  $("#plano-mensal").innerHTML = botaoCompra(CFG.checkout_mesa_mensal, "Assinar mensal", "ghost");
  $("#plano-anual").innerHTML  = botaoCompra(CFG.checkout_mesa_anual,  "Assinar anual",  "marker");
  const email = CFG.email_contato || "";
  $("#email-contato").innerHTML = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "";
  const foto = $("#foto-sobre"), fotoUrl = urlSegura(CFG.foto_sobre);
  if(fotoUrl){ foto.src = fotoUrl; foto.hidden = false; } else foto.hidden = true;
}

function montarNewsletter(){
  $(".news-slot").innerHTML = `<div class="news">
    <div><h2>Receba os editais na sua caixa de entrada</h2><p>Um e-mail por semana com os concursos novos e o artigo da semana.</p></div>
    <form id="news-form" novalidate>
      <label for="news-email">Seu e-mail</label>
      <input id="news-email" type="email" placeholder="seu@email.com" autocomplete="email" maxlength="254" required>
      <button class="btn" type="submit">Quero receber</button>
      <p class="consent">Sem spam. Você pode cancelar a qualquer momento respondendo qualquer e-mail.</p>
      <p class="msg" id="news-msg" role="status" aria-live="polite"></p>
    </form></div>`;
  $("#news-form").addEventListener("submit", async e=>{
    e.preventDefault();
    const inp = $("#news-email"), msg = $("#news-msg"), btn = e.target.querySelector("button");
    const v = inp.value.trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ msg.textContent = "Digite um e-mail válido, como nome@gmail.com."; inp.setAttribute("aria-invalid","true"); inp.focus(); return; }
    inp.removeAttribute("aria-invalid");
    if(!sb){ msg.textContent = "A inscrição está indisponível no momento. Tente mais tarde."; return; }
    btn.disabled = true; msg.textContent = "Enviando…";
    const { error } = await sb.from("site_newsletter").insert({ email:v });
    btn.disabled = false;
    if(!error || error.code === "23505"){ msg.textContent = "Pronto! Você vai receber o próximo e-mail."; e.target.reset(); }
    else { console.error(error); msg.textContent = "Não foi possível inscrever agora. Tente de novo em instantes."; }
  });
}

/* ---------- SEO ---------- */
function meta(sel, attr, valor){
  let el = document.head.querySelector(sel);
  if(!el){ el = document.createElement(sel.startsWith("link")?"link":"meta");
    const m = sel.match(/\[(\w+(?::\w+)?)="([^"]+)"\]/); el.setAttribute(m[1], m[2]); document.head.appendChild(el); }
  el.setAttribute(attr, valor);
}
function definirSEO({titulo, descricao=DESC_PADRAO, url=BASE, imagem="", tipo="website", jsonld=null}){
  document.title = titulo ? `${titulo} · ${NOME_SITE}` : `${NOME_SITE} · Estudo para concursos, do edital à posse`;
  meta('meta[name="description"]', "content", descricao);
  meta('link[rel="canonical"]', "href", url);
  meta('meta[property="og:title"]', "content", titulo || NOME_SITE);
  meta('meta[property="og:description"]', "content", descricao);
  meta('meta[property="og:url"]', "content", url);
  meta('meta[property="og:type"]', "content", tipo);
  if(imagem) meta('meta[property="og:image"]', "content", imagem);
  let ld = document.getElementById("ld-pagina");
  if(jsonld){
    if(!ld){ ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = "ld-pagina"; document.head.appendChild(ld); }
    ld.textContent = JSON.stringify(jsonld);
  } else if(ld) ld.remove();
}
const SEO_VIEWS = {
  inicio:   {},
  artigos:  {titulo:"Artigos sobre estudos para concursos", descricao:"Método, organização, revisões e técnicas de memorização aplicadas ao estudo para concursos públicos."},
  concursos:{titulo:"Concursos abertos e previstos", descricao:"Radar de concursos das áreas Tribunal, Fiscal, Controle e Gestão, Policial, Bancária, Legislativa e Administrativa: situação, vagas, salário, banca e inscrições."},
  materiais:{titulo:"Materiais para concursos", descricao:"Resumos, mapas mentais e cadernos de questões em PDF para concursos públicos."},
  "mesa-de-estudos":{titulo:"Mesa de Estudos", descricao:"Ciclo de estudos, cronômetro de horas líquidas, revisões programadas e desempenho em questões num só lugar."},
  sobre:    {titulo:"Sobre", descricao:"Quem escreve o Rumo à Posse e como entrar em contato."}
};

/* ---------- Artigo ---------- */
let pedidoArtigo = 0;
async function mostrarArtigo(slug){
  const caixa = $("#article-body"), voltar = `<a class="back" href="#artigos">← Todos os artigos</a>`;
  const a = ARTIGOS.find(x=>x.slug===slug);
  const naoAchou = () => {
    caixa.innerHTML = `${voltar}<h1 tabindex="-1">Artigo não encontrado</h1><p>Ele pode ter sido removido ou ainda não foi publicado.</p>`;
    definirSEO({titulo:"Artigo não encontrado"});
    meta('meta[name="robots"]', "content", "noindex");
  };
  if(!a){ naoAchou(); return; }
  meta('meta[name="robots"]', "content", "index,follow");
  const capa = urlSegura(a.imagem_capa);
  const url = BASE + linkArtigo(slug);
  definirSEO({ titulo:a.titulo, descricao:a.resumo || DESC_PADRAO, url, imagem:capa, tipo:"article",
    jsonld:{ "@context":"https://schema.org", "@type":"BlogPosting", headline:a.titulo, description:a.resumo,
      datePublished:a.data_publicacao, image:capa||undefined, mainEntityOfPage:url, inLanguage:"pt-BR",
      articleSection:a.categoria, author:{"@type":"Person", name:"Rumo à Posse"}, publisher:{"@type":"Organization", name:NOME_SITE} } });

  const cabeca = `${voltar}
    <h1 tabindex="-1">${esc(a.titulo)}</h1>
    <div class="meta"><span class="tag">${esc(a.categoria)}</span> · <time datetime="${esc(a.data_publicacao)}">${fmtData(a.data_publicacao)}</time> · ${esc(a.minutos)} min de leitura</div>
    ${capa ? `<img class="capa" src="${esc(capa)}" alt="" fetchpriority="high">` : ""}`;
  const rodape = `<blockquote><strong>Organize tudo isso sem planilha.</strong> A Mesa de Estudos monta o ciclo, cronometra e agenda suas revisões. <a href="#mesa-de-estudos">Conhecer</a></blockquote>`;
  const meu = ++pedidoArtigo;
  if(!corpos.has(slug)) caixa.innerHTML = cabeca + `<div class="skel-text" aria-label="Carregando o artigo"><i></i><i></i><i></i><i></i></div>`;
  try{
    const corpo = await buscarCorpo(slug);
    if(meu !== pedidoArtigo) return;                         // usuário já foi para outra página
    if(corpo == null){ naoAchou(); return; }
    const tinhaFoco = caixa.contains(document.activeElement);
    caixa.innerHTML = cabeca + limpa(corpo) + rodape + relacionados(a);
    if(tinhaFoco) caixa.querySelector("h1").focus({preventScroll:true});
  }catch(e){
    console.error(e);
    if(meu === pedidoArtigo) caixa.innerHTML = cabeca + `<p>Não foi possível carregar o artigo. Verifique sua conexão e <a href="${linkArtigo(slug)}">tente de novo</a>.</p>`;
  }
}
function relacionados(a){
  const outros = ARTIGOS.filter(x=>x.slug!==a.slug).sort((x,y)=>(y.categoria===a.categoria)-(x.categoria===a.categoria)).slice(0,3);
  return outros.length ? `<section class="related" aria-labelledby="rel-h"><h2 id="rel-h">Continue lendo</h2><div class="grid g3">${outros.map(cardArtigo).join("")}</div></section>` : "";
}

/* ---------- Página do concurso ---------- */
function linksDaBanca(c){
  const lista = Array.isArray(c.links_banca) ? c.links_banca : [];
  const manual = urlSegura(c.link_edital);
  const out = manual ? [{ rotulo: "Página oficial do edital", url: manual }] : [];
  for(const l of lista){ const u = urlSegura(l && l.url); if(u && !out.some(o=>o.url===u)) out.push({ rotulo: String(l.rotulo||"Página do concurso na banca"), url: u }); }
  return out;
}
function frase(c){
  const nome = c.orgao_nome && c.orgao_nome !== c.orgao ? `${c.orgao_nome} (${c.orgao})` : c.orgao;
  const sit = {
    aberto: "está com inscrições abertas",
    edital: "já tem edital publicado",
    autorizado: "foi autorizado e está em preparação",
    previsto: "está previsto e ainda não tem edital"
  }[c.situacao] || "está em acompanhamento";
  const partes = [`O concurso ${nome} ${sit}.`];
  if(c.cargo && c.cargo !== "A definir") partes.push(`Cargos: ${c.cargo.charAt(0).toLowerCase() + c.cargo.slice(1)}.`);
  if(c.banca && c.banca !== "A definir") partes.push(`A banca organizadora é ${c.banca}.`);
  return partes.join(" ");
}
function mostrarConcurso(id){
  const caixa = $("#concurso-body"), voltar = `<a class="back" href="#concursos">← Todos os concursos</a>`;
  const c = CONCURSOS.find(x => slugConcurso(x) === id);
  if(!c){
    caixa.innerHTML = `${voltar}<h1 tabindex="-1">Concurso não encontrado</h1><p>Ele pode ter saído da lista de acompanhamento. Veja os <a href="#concursos">concursos atuais</a>.</p>`;
    definirSEO({titulo:"Concurso não encontrado"}); meta('meta[name="robots"]', "content", "noindex");
    return;
  }
  meta('meta[name="robots"]', "content", "index,follow");
  const url = BASE + linkConcurso(c);
  definirSEO({ titulo:`Concurso ${c.orgao}: ${SITUACOES[c.situacao]||""}`, descricao: frase(c) + (c.salario && c.salario!=="A definir" ? ` Remuneração: ${c.salario}.` : ""), url });

  const campo = (rot, v) => v && v !== "" ? `<div><dt>${rot}</dt><dd>${esc(v)}</dd></div>` : "";
  const fonte = urlSegura(c.fonte_url), banca = linksDaBanca(c);
  const temEdital = c.situacao === "aberto" || c.situacao === "edital";
  const sinc = CFG.concursos_sincronizado_em ? new Date(CFG.concursos_sincronizado_em) : null;
  const outros = CONCURSOS.filter(x => x !== c && x.area === c.area).slice(0,3);
  caixa.innerHTML = `${voltar}
    <div class="conc-head">
      <span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span>${c.area ? `<span class="tag">${esc(c.area)}</span>` : ""}
    </div>
    <h1 tabindex="-1">Concurso ${esc(c.orgao)}</h1>
    ${c.orgao_nome && c.orgao_nome !== c.orgao ? `<p class="conc-orgao">${esc(c.orgao_nome)}</p>` : ""}
    <p class="conc-resumo">${esc(frase(c))}</p>
    <dl class="ficha">
      ${campo("Situação", c.status_fonte || SITUACOES[c.situacao])}
      ${campo("Cargos", c.cargo)}
      ${campo("Vagas", c.vagas)}
      ${campo("Remuneração", c.salario)}
      ${campo("Banca", c.banca)}
      ${campo("Escolaridade", c.escolaridade)}
      ${campo("Inscrições", c.inscricoes)}
      ${campo("Provas", c.provas)}
    </dl>
    ${banca.length ? `<div class="banca-box">
      <h2>Inscrição e edital na banca</h2>
      <p>${c.situacao==="aberto" ? "As inscrições são feitas no site da banca organizadora. Lá você encontra o edital completo, o formulário de inscrição e os comunicados." : "No site da banca organizadora você encontra o edital completo, os comunicados e as próximas etapas."}</p>
      <div class="conc-acoes">${banca.map((l,i)=>`<a class="btn ${i===0?"marker":"ghost"}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.rotulo)}${novaAba}</a>`).join("")}</div>
    </div>` : temEdital ? `<p class="banca-box banca-vazia">O link da página do concurso na banca ${esc(c.banca)} ainda não foi localizado. Procure por "${esc(c.orgao)}" no site da banca.</p>` : ""}
    <div id="conc-detalhes" aria-live="polite">${c.chave ? `<div class="skel-text" aria-label="Carregando os detalhes"><i></i><i></i><i></i></div>` : ""}</div>
    <div class="conc-acoes" id="conc-fonte-btn">
      ${fonte ? `<a class="btn ghost" href="${esc(fonte)}" target="_blank" rel="noopener noreferrer">Notícia completa na Folha Dirigida${novaAba}</a>` : ""}
    </div>
    <p class="conc-fonte" id="conc-fonte-txt">${fonte ? "Informações reunidas pelo Qconcursos Folha Dirigida" : "Informações cadastradas pelo Rumo à Posse"}${sinc && !isNaN(sinc) && fonte ? `, atualizadas em ${sinc.toLocaleDateString("pt-BR")}` : ""}. Datas e regras podem mudar: confirme sempre no edital oficial.</p>
    <blockquote><strong>Vai prestar este concurso?</strong> A Mesa de Estudos monta o seu ciclo a partir do edital, cronometra as horas líquidas e agenda as revisões. <a href="#mesa-de-estudos">Conhecer</a></blockquote>
    ${outros.length ? `<section class="related" aria-labelledby="rel-c"><h2 id="rel-c">Outros concursos de ${esc(c.area)}</h2><div class="grid g3">${outros.map(cardConcurso).join("")}</div></section>` : ""}`;
  if(c.chave) carregarDetalhes(c);
}

/* ---------- Ficha completa (fatos extraídos da matéria) ---------- */
const detalhesCache = new Map();
async function carregarDetalhes(c){
  const alvo = () => document.getElementById("conc-detalhes");
  let d = detalhesCache.get(c.chave);
  if(d === undefined && sb){
    try{
      const r = await sb.from("site_concursos").select("detalhes").eq("chave", c.chave).maybeSingle();
      d = r.data ? r.data.detalhes : null; detalhesCache.set(c.chave, d);
    }catch(e){ d = null; }
  }
  const caixa = alvo(); if(!caixa) return;                    // a pessoa já saiu da página
  if(!d || (!(d.secoes||[]).length && !(d.ficha||[]).length)){ caixa.innerHTML = ""; return; }
  caixa.innerHTML = htmlDetalhes(d);
  // itens extras na ficha principal (taxa, validade, jornada…)
  const dl = document.querySelector("#concurso-body .ficha");
  if(dl) dl.insertAdjacentHTML("beforeend", extrasFicha(d));
  const mat = urlSegura(d.materia_url);
  if(mat && /folha\.qconcursos\.com\/n\//.test(mat)){
    const btn = document.querySelector("#conc-fonte-btn a"); if(btn) btn.href = mat;
    const lido = d.lido_em ? new Date(d.lido_em) : null;
    const t = document.getElementById("conc-fonte-txt");
    if(t) t.innerHTML = `Dados levantados da <a href="${esc(mat)}" target="_blank" rel="noopener noreferrer">matéria da Folha Dirigida${novaAba}</a> e organizados pelo Rumo à Posse${lido && !isNaN(lido) ? ` em ${lido.toLocaleDateString("pt-BR")}` : ""}. Datas e regras podem mudar: confirme sempre no edital oficial.`;
  }
}
const JA_NA_FICHA = /^(órg[ãa]o|institui[çc][ãa]o|situa[çc][ãa]o|status|banca|cargos?|escolaridade|vagas|remunera[çc][ãa]o|sal[áa]rios?|inscri[çc][õo]es|provas?|data das? provas?)( (atual|organizadora|inicial))?$/i;
function extrasFicha(d){
  const itens = (d.ficha||[]).filter(f => !JA_NA_FICHA.test(f.rotulo.trim())).slice(0,8)
    .map(f => [f.rotulo, f.valor]);
  if(d.questoes) itens.push(["Questões na prova objetiva", d.questoes]);
  if(d.validade) itens.push(["Validade", d.validade]);
  if(d.jornada) itens.push(["Jornada", d.jornada]);
  return itens.map(([r,v]) => `<div><dt>${esc(r)}</dt><dd>${esc(v)}</dd></div>`).join("");
}
const ORDEM_SECOES = ["cargos","requisitos","remuneracao","inscricao","etapas","prova","taf","datas"];
function htmlDetalhes(d){
  const secoes = new Map((d.secoes||[]).map(s => [s.id, s]));
  // salários e benefícios entram na seção de remuneração; isenção na de inscrição
  if((d.salarios||[]).length || (d.beneficios||[]).length){
    const s = secoes.get("remuneracao") || { id:"remuneracao", titulo:"Remuneração e benefícios", grupos:[], tabelas:[] };
    const grupos = [];
    if(d.salarios.length) grupos.push({ titulo:"Salário inicial", itens: d.salarios.map(x => `${x.cargo}: ${x.valor}`) });
    if(d.beneficios.length) grupos.push({ titulo:"Benefícios", itens: d.beneficios.map(x => `${x.nome}: ${x.valor}`) });
    s.grupos = grupos.concat(s.grupos); secoes.set("remuneracao", s);
  }
  if(d.isencao){
    const s = secoes.get("inscricao") || { id:"inscricao", titulo:"Inscrição e taxa", grupos:[], tabelas:[] };
    const itens = [];
    if(d.isencao.periodo) itens.push(`Prazo para pedir: ${d.isencao.periodo}`);
    d.isencao.publico.forEach(p => itens.push(p));
    if(!itens.length) itens.push("Há previsão de pedido no edital");
    s.grupos = [{ titulo: d.isencao.tipo, itens }].concat(s.grupos); secoes.set("inscricao", s);
  }
  const lista = ORDEM_SECOES.map(id => secoes.get(id)).filter(Boolean);
  if(!lista.length) return "";
  const idSec = id => "sec-" + id;
  const grupo = g => `<div class="det-grupo">${g.titulo ? `<h3>${esc(g.titulo)}</h3>` : ""}
    <ul class="${g.itens.length > 8 ? "cols" : ""}">${g.itens.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
  const tabela = t => {
    const [cab, ...linhas] = t.linhas;
    return `<div class="table-wrap det-tabela"><table><thead><tr>${cab.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${linhas.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  };
  return `<nav class="det-sumario" aria-label="Nesta página"><strong>Nesta página:</strong>
      ${lista.map(s => `<a href="#${idSec(s.id)}" data-scroll="${idSec(s.id)}">${esc(s.titulo)}</a>`).join("")}</nav>
    ${lista.map(s => `<section class="det-secao" id="${idSec(s.id)}" aria-labelledby="${idSec(s.id)}-h">
      <h2 id="${idSec(s.id)}-h">${esc(s.titulo)}</h2>
      ${s.grupos.map(grupo).join("")}${(s.tabelas||[]).map(tabela).join("")}
    </section>`).join("")}`;
}

/* ---------- Rotas ---------- */
const VIEWS = ["inicio","artigos","concursos","materiais","mesa-de-estudos","sobre"];
function rota(){
  const h = decodeURIComponent((location.hash||"").slice(1));
  // links antigos: #artigo-slug  ->  ?artigo=slug
  if(h.startsWith("artigo-")){ history.replaceState(null, "", location.pathname + linkArtigo(h.slice(7))); return rota(); }
  const params = new URLSearchParams(location.search);
  const slug = params.get("artigo"), conc = params.get("concurso");
  let view = h ? (VIEWS.includes(h) ? h : null) : (slug ? "artigo" : conc ? "concurso" : "inicio");
  if(["planos","recursos"].includes(h)) view = "mesa-de-estudos";
  if(!view) view = "inicio";

  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="v-"+view));
  document.querySelectorAll("nav.main a").forEach(a=>{
    const alvo = a.getAttribute("href").slice(1);
    const ativo = alvo===view || (view==="artigo" && alvo==="artigos") || (view==="concurso" && alvo==="concursos");
    ativo ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current");
  });
  fecharMenu();
  if(view==="artigo") mostrarArtigo(slug);
  else if(view==="concurso") mostrarConcurso(conc);
  else {
    meta('meta[name="robots"]', "content", "index,follow");
    const s = SEO_VIEWS[view] || {};
    definirSEO({...s, url: view==="inicio" ? BASE : BASE + "#" + view});
  }

  if(["planos","recursos"].includes(h)) document.getElementById(h).scrollIntoView();
  else window.scrollTo(0,0);
  // leva o foco para o título da nova página (leitores de tela anunciam a troca)
  if(!primeiraRota){
    const alvo = document.querySelector(`#v-${view} h1, #v-${view} h2`);
    if(alvo){ alvo.setAttribute("tabindex","-1"); alvo.focus({preventScroll:true}); }
  }
  primeiraRota = false;
}

/* Navegação interna sem recarregar a página */
document.addEventListener("click", e=>{
  if(e.defaultPrevented || e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  if(!a || a.target==="_blank" || a.hasAttribute("download")) return;
  if(a.hasAttribute("data-skip")){ e.preventDefault(); $("#conteudo").focus(); return; }
  const raw = a.getAttribute("href");
  let destino;
  if(raw.startsWith("#")) destino = location.pathname + raw;           // troca de seção: tira o ?artigo=
  else if(raw.startsWith("?")) destino = location.pathname + raw;
  else return;
  if(a.dataset.scroll){
    e.preventDefault();
    document.getElementById(a.dataset.scroll).scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    return;
  }
  e.preventDefault();
  if(destino !== location.pathname + location.search + location.hash) history.pushState(null, "", destino);
  rota();
});
window.addEventListener("popstate", rota);

/* ---------- Diversos ---------- */
let toastT;
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove("show"), 4200);
}
document.addEventListener("click", e=>{
  if(e.target.closest("[data-sem-link]")) toast("Este produto ainda não está à venda. Volte em breve!");
});
function fecharMenu(){ $("#nav").classList.remove("open"); $("#menu-btn").setAttribute("aria-expanded","false"); }
$("#menu-btn").addEventListener("click", ()=>{
  const open = $("#nav").classList.toggle("open");
  $("#menu-btn").setAttribute("aria-expanded", open);
  if(open) $("#nav a").focus();
});
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && $("#nav").classList.contains("open")){ fecharMenu(); $("#menu-btn").focus(); }
});
document.addEventListener("click", e=>{
  if($("#nav").classList.contains("open") && !e.target.closest("#nav, #menu-btn")) fecharMenu();
});
$("#ano").textContent = new Date().getFullYear();

/* ---------- Início ---------- */
(async function iniciar(){
  const c = window.SITE_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_KEY && window.supabase){
    sb = supabase.createClient(c.SUPABASE_URL, c.SUPABASE_KEY,
      { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
  }
  montarNewsletter();

  // 1) Mostra na hora o que estiver guardado da última visita
  const cache = sb && lerCache();
  if(cache){ aplicar(cache); renderTudo(); rota(); }

  // 2) Busca a versão atual e só redesenha se algo mudou
  let novo = null;
  if(sb){
    try{ novo = await buscarSupabase(); }
    catch(e){ console.error("Não foi possível ler o Supabase:", e); }
  }
  if(!novo && !cache) novo = dadosExemplo();
  if(novo){
    if(!novo.exemplo) gravarCache(novo);
    if(!cache || JSON.stringify(cache) !== JSON.stringify(novo)){
      aplicar(novo); renderTudo();
      const slug = new URLSearchParams(location.search).get("artigo");
      // com cache, só refaz a rota se o artigo aberto não existia na versão guardada
      if(!cache) rota();
      else if(slug && !location.hash && !cache.artigos.some(x=>x.slug===slug)){ primeiraRota = true; rota(); }
      // a página do concurso é montada só com os dados da lista: redesenha com a versão nova
      else if(new URLSearchParams(location.search).get("concurso") && !location.hash){ primeiraRota = true; rota(); }
    }
  }
})();
