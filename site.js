/* Rumo à Posse · site público
   O conteúdo vem do Supabase (editado pelo painel admin.html).
   Sem Supabase configurado, mostra o conteúdo de exemplo. */

let ARTIGOS = [], CONCURSOS = [], PRODUTOS = [], CFG = {};
let MODO_EXEMPLO = true;
const SITUACOES = {aberto:"Inscrições abertas", edital:"Edital publicado", autorizado:"Autorizado", previsto:"Previsto"};

const $ = s => document.querySelector(s);
const fmtData = d => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"}) : "";
const esc = s => String(s ?? "").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const limpa = html => window.DOMPurify ? DOMPurify.sanitize(html) : String(html||"");
const vazio = msg => `<p style="color:var(--muted)">${msg}</p>`;

async function carregar(){
  const c = window.SITE_CONFIG || {};
  if (c.SUPABASE_URL && c.SUPABASE_KEY && window.supabase){
    try{
      const sb = supabase.createClient(c.SUPABASE_URL, c.SUPABASE_KEY);
      const [a,k,p,g] = await Promise.all([
        sb.from("site_artigos").select("*").eq("publicado",true).order("data_publicacao",{ascending:false}),
        sb.from("site_concursos").select("*").eq("publicado",true).order("ordem").order("atualizado_em",{ascending:false}),
        sb.from("site_produtos").select("*").eq("publicado",true).order("ordem"),
        sb.from("site_config").select("*")
      ]);
      for (const r of [a,k,p,g]) if (r.error) throw r.error;
      ARTIGOS = a.data; CONCURSOS = k.data; PRODUTOS = p.data;
      CFG = Object.fromEntries(g.data.map(x=>[x.chave,x.valor]));
      MODO_EXEMPLO = false;
      return;
    }catch(e){ console.error("Não foi possível ler o Supabase:", e); }
  }
  const ex = window.DADOS_EXEMPLO;
  ARTIGOS = ex.artigos; CONCURSOS = ex.concursos; PRODUTOS = ex.produtos; CFG = ex.config;
}

function cardArtigo(a){
  const capa = a.imagem_capa
    ? `<img class="thumb" src="${esc(a.imagem_capa)}" alt="" loading="lazy">`
    : `<div class="thumb thumb-ph" aria-hidden="true"><span>${esc(a.categoria)}</span></div>`;
  return `<div class="card"><a class="stretch" href="#artigo-${esc(a.slug)}">${capa}
    <span class="tag" style="margin-top:4px">${esc(a.categoria)}</span>
    <h3 style="margin-top:10px">${esc(a.titulo)}</h3></a>
    <p>${esc(a.resumo)}</p>
    <div class="meta"><span>${fmtData(a.data_publicacao)}</span><span>${esc(a.minutos)} min de leitura</span></div></div>`;
}
function cardConcurso(c){
  return `<div class="card"><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span>
    <h3>${esc(c.orgao)}</h3><p>${esc(c.cargo)}</p>
    <div class="meta"><span>Vagas: ${esc(c.vagas)}</span><span>Banca: ${esc(c.banca)}</span></div>
    ${c.link_edital ? `<a href="${esc(c.link_edital)}" target="_blank" rel="noopener">Ver edital →</a>` : ""}</div>`;
}
function cardProduto(p){
  const itens = String(p.itens||"").split("\n").map(s=>s.trim()).filter(Boolean);
  return `<div class="card product">
    ${p.imagem
      ? `<img class="cover cover-img" src="${esc(p.imagem)}" alt="Capa: ${esc(p.titulo)}" loading="lazy">`
      : `<div class="cover" style="background:${esc(p.cor||"#ffd93b")}">${esc(p.titulo)}</div>`}
    <span class="tag" style="align-self:flex-start">${esc(p.tipo)}</span>
    <h3>${esc(p.titulo)}</h3>
    <ul>${itens.map(i=>`<li>${esc(i)}</li>`).join("")}</ul>
    <div class="buy"><span class="price">${p.preco_antigo?`<s>R$ ${esc(p.preco_antigo)}</s>`:""}R$ ${esc(p.preco)}</span>
    <button class="btn small" data-link="${esc(p.link_checkout||"")}">Comprar</button></div></div>`;
}

function filtros(el, opcoes, onPick){
  let atual = "Todos";
  const render = () => {
    el.innerHTML = ["Todos",...opcoes].map(o=>`<button class="chip" aria-pressed="${o===atual}" data-v="${esc(o)}">${esc(o)}</button>`).join("");
  };
  el.onclick = e => {
    const b = e.target.closest(".chip"); if(!b) return;
    atual = b.dataset.v; render(); onPick(atual);
  };
  render(); onPick(atual);
}

function renderTudo(){
  $("#home-articles").innerHTML = ARTIGOS.slice(0,3).map(cardArtigo).join("") || vazio("Nenhum artigo publicado ainda.");
  $("#home-concursos").innerHTML = CONCURSOS.slice(0,3).map(cardConcurso).join("") || vazio("Nenhum concurso cadastrado ainda.");
  $("#home-produtos").innerHTML = PRODUTOS.slice(0,3).map(cardProduto).join("") || vazio("Nenhum material à venda ainda.");
  $("#conc-notice").hidden = !MODO_EXEMPLO;

  filtros($("#art-filters"), [...new Set(ARTIGOS.map(a=>a.categoria))], cat=>{
    $("#all-articles").innerHTML = ARTIGOS.filter(a=>cat==="Todos"||a.categoria===cat).map(cardArtigo).join("") || vazio("Nenhum artigo nesta categoria.");
  });
  filtros($("#conc-filters"), Object.values(SITUACOES), sit=>{
    const linhas = CONCURSOS.filter(c=>sit==="Todos"||SITUACOES[c.situacao]===sit).map(c=>`
      <tr><td><strong>${esc(c.orgao)}</strong><br><span style="color:var(--muted)">${esc(c.cargo)}</span>
      ${c.link_edital ? `<br><a href="${esc(c.link_edital)}" target="_blank" rel="noopener">Edital</a>` : ""}</td>
      <td><span class="status s-${esc(c.situacao)}">${SITUACOES[c.situacao]||""}</span></td>
      <td class="num">${esc(c.vagas)}</td><td class="num">${esc(c.salario)}</td>
      <td>${esc(c.banca)}</td><td>${esc(c.escolaridade)}</td></tr>`).join("");
    $("#conc-body").innerHTML = linhas || `<tr><td colspan="6" style="color:var(--muted)">Nenhum concurso nesta situação.</td></tr>`;
  });
  filtros($("#prod-filters"), [...new Set(PRODUTOS.map(p=>p.tipo))], t=>{
    $("#all-produtos").innerHTML = PRODUTOS.filter(p=>t==="Todos"||p.tipo===t).map(cardProduto).join("") || vazio("Nenhum material nesta categoria.");
  });

  document.querySelector('[data-plano="mensal"]').dataset.link = CFG.checkout_mesa_mensal || "";
  document.querySelector('[data-plano="anual"]').dataset.link = CFG.checkout_mesa_anual || "";
  $("#email-contato").textContent = CFG.email_contato || "";
  const foto = $("#foto-sobre");
  if(CFG.foto_sobre){ foto.src = CFG.foto_sobre; foto.hidden = false; } else foto.hidden = true;

  $(".news-slot").innerHTML = `<div class="news">
    <div><h2>Receba os editais na sua caixa de entrada</h2><p>Um e-mail por semana com os concursos novos e o artigo da semana.</p></div>
    <form id="news-form" novalidate>
      <label for="news-email">Seu e-mail</label>
      <input id="news-email" type="email" placeholder="seu@email.com" required>
      <button class="btn" type="submit">Quero receber</button>
      <p class="msg" id="news-msg" aria-live="polite"></p>
    </form></div>`;
  $("#news-form").addEventListener("submit", e=>{
    e.preventDefault();
    const v = $("#news-email").value.trim();
    $("#news-msg").textContent = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)
      ? "Formulário de demonstração: a newsletter ainda vai ser ligada a um serviço de e-mail."
      : "Digite um e-mail válido, como nome@gmail.com.";
  });
}

function mostrarArtigo(slug){
  const a = ARTIGOS.find(x=>x.slug===slug);
  if(!a){
    $("#article-body").innerHTML = `<a class="back" href="#artigos">← Todos os artigos</a><h1>Artigo não encontrado</h1><p>Ele pode ter sido removido ou ainda não foi publicado.</p>`;
    return;
  }
  $("#article-body").innerHTML = `<a class="back" href="#artigos">← Todos os artigos</a>
    <h1>${esc(a.titulo)}</h1>
    <div class="meta"><span class="tag">${esc(a.categoria)}</span> · ${fmtData(a.data_publicacao)} · ${esc(a.minutos)} min de leitura</div>
    ${a.imagem_capa ? `<img class="capa" src="${esc(a.imagem_capa)}" alt="">` : ""}
    ${limpa(a.corpo)}
    <blockquote><strong>Organize tudo isso sem planilha.</strong> A Mesa de Estudos monta o ciclo, cronometra e agenda suas revisões. <a href="#mesa-de-estudos">Conhecer</a></blockquote>`;
  document.title = a.titulo + " · Rumo à Posse";
}

const VIEWS = ["inicio","artigos","concursos","materiais","mesa-de-estudos","sobre"];
function rota(){
  const h = (location.hash||"").slice(1) || "inicio";
  let view = VIEWS.includes(h) ? h : (h.startsWith("artigo-") ? "artigo" : null);
  if(["planos","recursos"].includes(h)) view = "mesa-de-estudos";
  if(!view) view = "inicio";
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="v-"+view));
  document.querySelectorAll("nav.main a").forEach(a=>{
    const alvo = a.getAttribute("href").slice(1);
    const ativo = alvo===view || (view==="artigo" && alvo==="artigos");
    ativo ? a.setAttribute("aria-current","page") : a.removeAttribute("aria-current");
  });
  if(view==="artigo") mostrarArtigo(h.slice(7));
  else document.title = "Rumo à Posse";
  $("#nav").classList.remove("open"); $("#menu-btn").setAttribute("aria-expanded","false");
  if(["planos","recursos"].includes(h)) document.getElementById(h).scrollIntoView();
  else window.scrollTo(0,0);
}

let toastT;
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(()=>t.classList.remove("show"), 4200);
}

document.addEventListener("click", e=>{
  const b = e.target.closest("[data-link]");
  if(b){
    const link = b.dataset.link;
    if(link) window.open(link, "_blank", "noopener");
    else toast("Link de pagamento ainda não configurado para este produto.");
  }
  const s = e.target.closest("[data-scroll]");
  if(s){ e.preventDefault(); document.getElementById(s.dataset.scroll).scrollIntoView({behavior:"smooth"}); }
});
$("#menu-btn").addEventListener("click", ()=>{
  const open = $("#nav").classList.toggle("open");
  $("#menu-btn").setAttribute("aria-expanded", open);
});

carregar().then(()=>{
  renderTudo();
  window.addEventListener("hashchange", rota);
  rota();
});
