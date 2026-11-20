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
function aplicar(d){ ARTIGOS=d.artigos; CONCURSOS=d.concursos; PRODUTOS=d.produtos; CFG=d.config; MODO_EXEMPLO=!!d.exemplo; }

async function buscarSupabase(){
  const [a,k,p,g] = await Promise.all([
    sb.from("site_artigos").select(COLS_ARTIGO).eq("publicado",true).order("data_publicacao",{ascending:false}),
    sb.from("site_concursos").select("orgao,cargo,situacao,vagas,salario,banca,escolaridade,link_edital").eq("publicado",true).order("ordem").order("atualizado_em",{ascending:false}),
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
    ? `<img class="thumb" src="${esc(urlSegura(a.imagem_capa))}" alt="" loading="lazy" decoding="async" width="640" height="360">`
    : `<div class="thumb thumb-ph" aria-hidden="true"><span>${esc(a.categoria)}</span></div>`;
  return `<article class="card"><a class="stretch" href="${linkArtigo(a.slug)}">${capa}
    <span class="tag" style="margin-top:4px">${esc(a.categoria)}</span>
    <h3 style="margin-top:10px">${esc(a.titulo)}</h3></a>
    <p>${esc(a.resumo)}</p>
    <div class="meta"><time datetime="${esc(a.data_publicacao)}">${fmtData(a.data_publicacao)}</time><span>${esc(a.minutos)} min de leitura</span></div></article>`;
}
function cardConcurso(c){
  const link = urlSegura(c.link_edital);
  return `<div class="card"><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span>
    <h3>${esc(c.orgao)}</h3><p>${esc(c.cargo)}</p>
    <div class="meta"><span>Vagas: ${esc(c.vagas)}</span><span>Banca: ${esc(c.banca)}</span></div>
    ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver edital <span aria-hidden="true">→</span><span class="sr-only"> (abre em nova aba)</span></a>` : ""}</div>`;
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

function filtros(el, opcoes, onPick){
  let atual = "Todos";
  const render = () => {
    el.innerHTML = ["Todos",...opcoes].map(o=>`<button type="button" class="chip" aria-pressed="${o===atual}" data-v="${esc(o)}">${esc(o)}</button>`).join("");
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
  filtros($("#conc-filters"), Object.values(SITUACOES), sit=>{
    const linhas = CONCURSOS.filter(c=>sit==="Todos"||SITUACOES[c.situacao]===sit).map(c=>{
      const link = urlSegura(c.link_edital);
      return `<tr><th scope="row"><strong>${esc(c.orgao)}</strong><br><span style="color:var(--muted);font-weight:400">${esc(c.cargo)}</span>
      ${link ? `<br><a href="${esc(link)}" target="_blank" rel="noopener noreferrer" style="font-weight:600">Edital<span class="sr-only"> de ${esc(c.orgao)} (abre em nova aba)</span></a>` : ""}</th>
      <td><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span></td>
      <td class="num">${esc(c.vagas)}</td><td class="num">${esc(c.salario)}</td>
      <td>${esc(c.banca)}</td><td>${esc(c.escolaridade)}</td></tr>`;}).join("");
    $("#conc-body").innerHTML = linhas || `<tr><td colspan="6" style="color:var(--muted)">Nenhum concurso nesta situação.</td></tr>`;
  });
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
  concursos:{titulo:"Concursos abertos e previstos", descricao:"Radar de concursos: situação de cada certame, vagas, salário inicial, banca e escolaridade."},
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

/* ---------- Rotas ---------- */
const VIEWS = ["inicio","artigos","concursos","materiais","mesa-de-estudos","sobre"];
function rota(){
  const h = decodeURIComponent((location.hash||"").slice(1));
  // links antigos: #artigo-slug  ->  ?artigo=slug
  if(h.startsWith("artigo-")){ history.replaceState(null, "", location.pathname + linkArtigo(h.slice(7))); return rota(); }
  const slug = new URLSearchParams(location.search).get("artigo");
  let view = h ? (VIEWS.includes(h) ? h : null) : (slug ? "artigo" : "inicio");
  if(["planos","recursos"].includes(h)) view = "mesa-de-estudos";
  if(!view) view = "inicio";

  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="v-"+view));
  document.querySelectorAll("nav.main a").forEach(a=>{
    const alvo = a.getAttribute("href").slice(1);
    const ativo = alvo===view || (view==="artigo" && alvo==="artigos");
    ativo ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current");
  });
  fecharMenu();
  if(view==="artigo") mostrarArtigo(slug);
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
    }
  }
})();
