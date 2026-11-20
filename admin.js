/* Rumo à Posse · painel do autor */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hoje = () => new Date().toLocaleDateString("sv-SE");
const fmtData = d => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR") : "";
const slugify = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").slice(0,80).replace(/^-+|-+$/g,"");
let toastT;
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.remove("hidden"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.add("hidden"),3500); }
function erroAmigavel(e){
  const m = (e && (e.message||e.error_description)) || String(e);
  if (/duplicate key.*slug/i.test(m)) return "Já existe um artigo com esse endereço (slug). Mude o título ou o endereço.";
  if (/row-level security|permission denied/i.test(m)) return "Sem permissão. Confira se o seu e-mail está como administrador no Supabase.";
  if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/bucket not found/i.test(m)) return "A pasta de imagens não existe. Rode o arquivo supabase-imagens.sql no Supabase.";
  if (/imagem_capa|column .*imagem/i.test(m)) return "Faltam os campos de imagem no banco. Rode o arquivo supabase-imagens.sql no Supabase.";
  if (/_url|link_url|capa_url|img_url/i.test(m)) return "Os links precisam começar com https://";
  if (/slug_ok/i.test(m)) return "O endereço do artigo só pode ter letras minúsculas, números e hífens.";
  if (/cor_ok/i.test(m)) return "Cor inválida. Escolha uma das cores da lista.";
  if (/JWT expired|refresh_token/i.test(m)) return "Sua sessão expirou. Saia e entre de novo.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o Supabase. Verifique a internet e o config.js.";
  return m;
}

const CORES = [["#ffd93b","Amarelo"],["#bcd7ff","Azul"],["#c9f0d6","Verde"],["#e3d4ff","Lilás"],["#ffe0c2","Pêssego"]];
const SITUACOES = [["aberto","Inscrições abertas"],["edital","Edital publicado"],["autorizado","Autorizado"],["previsto","Previsto"]];

/* Definição de cada tipo de conteúdo */
const ENT = {
  artigos:{
    nome:"Artigos", tabela:"site_artigos", ordem:[["data_publicacao",false]],
    titulo:r=>r.titulo, sub:r=>`${r.categoria} · ${fmtData(r.data_publicacao)}`,
    novo:()=>({titulo:"",slug:"",categoria:"Método",resumo:"",imagem_capa:"",corpo:"",minutos:5,data_publicacao:hoje(),publicado:false}),
    campos:[
      {k:"titulo",label:"Título",tipo:"text",req:true},
      {k:"slug",label:"Endereço do artigo",tipo:"text",req:true,help:"Preenchido a partir do título. Aparece no link: site/?artigo=endereco. Evite mudar depois de publicado (o link antigo para de funcionar)."},
      {k:["categoria","data_publicacao"]},
      {k:"categoria",label:"Categoria",tipo:"text",lista:"cats",req:true},
      {k:"data_publicacao",label:"Data",tipo:"date",req:true},
      {k:"resumo",label:"Resumo",tipo:"textarea",help:"Uma ou duas frases que aparecem no cartão do artigo."},
      {k:"imagem_capa",label:"Imagem de capa",tipo:"imagem",pasta:"artigos",help:"Aparece no cartão e no topo do artigo. Formato deitado (16:9) fica melhor."},
      {k:"corpo",label:"Texto do artigo",tipo:"rich"},
      {k:"publicado",label:"Publicado (visível no site)",tipo:"check"}
    ]
  },
  concursos:{
    nome:"Concursos", tabela:"site_concursos", ordem:[["ordem",true],["atualizado_em",false]],
    titulo:r=>r.orgao, sub:r=>`${r.area?r.area+" · ":""}${r.cargo} · ${(SITUACOES.find(s=>s[0]===r.situacao)||[,""])[1]}${r.origem==="folha"?" · automático":""}`,
    novo:()=>({orgao:"",cargo:"",area:"Tribunal",situacao:"previsto",vagas:"A definir",salario:"A definir",banca:"A definir",escolaridade:"Superior",link_edital:"",ordem:0,publicado:true}),
    campos:[
      {k:["orgao","cargo"]},
      {k:"orgao",label:"Órgão",tipo:"text",req:true},
      {k:"cargo",label:"Cargo",tipo:"text",req:true},
      {k:["situacao","escolaridade"]},
      {k:"situacao",label:"Situação",tipo:"select",opts:SITUACOES},
      {k:"escolaridade",label:"Escolaridade",tipo:"select",opts:[["Fundamental","Fundamental"],["Médio","Médio"],["Técnico","Técnico"],["Superior","Superior"],["Médio e Superior","Médio e Superior"]]},
      {k:["vagas","salario"]},
      {k:"vagas",label:"Vagas",tipo:"text"},
      {k:"salario",label:"Salário inicial",tipo:"text",help:"Ex.: R$ 9.800,00"},
      {k:"area",label:"Área",tipo:"select",opts:[["Tribunal","Tribunal"],["Fiscal","Fiscal"],["Controle e Gestão","Controle e Gestão"],["Policial","Policial"],["Bancária","Bancária"],["Legislativa","Legislativa"],["Administrativa","Administrativa"],["","Outra"]]},
      {k:["banca","ordem"]},
      {k:"banca",label:"Banca",tipo:"text"},
      {k:"ordem",label:"Posição na lista",tipo:"number",help:"Menor número aparece primeiro."},
      {k:"link_edital",label:"Link do edital oficial (opcional)",tipo:"url"},
      {k:"publicado",label:"Publicado (visível no site)",tipo:"check"}
    ]
  },
  produtos:{
    nome:"Materiais", tabela:"site_produtos", ordem:[["ordem",true]],
    titulo:r=>r.titulo, sub:r=>`${r.tipo} · R$ ${r.preco}${r.link_checkout?"":" · sem link de pagamento"}`,
    novo:()=>({titulo:"",tipo:"Resumos",cor:"#ffd93b",imagem:"",preco:"",preco_antigo:"",itens:"",link_checkout:"",ordem:0,publicado:true}),
    campos:[
      {k:"titulo",label:"Nome do material",tipo:"text",req:true},
      {k:["tipo","cor"]},
      {k:"tipo",label:"Tipo",tipo:"text",lista:"tipos"},
      {k:"cor",label:"Cor da capa",tipo:"select",opts:CORES},
      {k:["preco","preco_antigo"]},
      {k:"preco",label:"Preço (R$)",tipo:"text",req:true,help:"Ex.: 47,90"},
      {k:"preco_antigo",label:"Preço antigo (opcional)",tipo:"text",help:"Aparece riscado."},
      {k:"imagem",label:"Imagem da capa (opcional)",tipo:"imagem",pasta:"materiais",help:"Sem imagem, a capa usa a cor escolhida."},
      {k:"itens",label:"O que vem no material",tipo:"textarea",help:"Um item por linha."},
      {k:"link_checkout",label:"Link de pagamento",tipo:"url",help:"Cole o link do checkout da Hotmart, Kiwify ou Mercado Pago."},
      {k:"ordem",label:"Posição na loja",tipo:"number",help:"Menor número aparece primeiro."},
      {k:"publicado",label:"Publicado (visível no site)",tipo:"check"}
    ]
  }
};

let sb, aba="artigos", linhas=[], atual=null, slugManual=false, sujo=false;

/* Avisa antes de perder um texto não salvo */
function confirmarSaida(){ return !sujo || confirm("Você tem alterações não salvas. Sair mesmo assim?"); }
addEventListener("beforeunload", e=>{ if(sujo){ e.preventDefault(); e.returnValue=""; } });

/* O texto salvo é limpo antes de entrar no editor (nada de script vindo do banco) */
const limparHTML = h => window.DOMPurify ? DOMPurify.sanitize(String(h||"")) : esc(String(h||""));

/* ---------- Início e login ---------- */
async function iniciar(){
  const c = window.SITE_CONFIG || {};
  if(!c.SUPABASE_URL || !c.SUPABASE_KEY){ $("#sem-config").classList.remove("hidden"); return; }
  sb = supabase.createClient(c.SUPABASE_URL, c.SUPABASE_KEY);
  const { data:{ session } } = await sb.auth.getSession();
  session ? entrarNoApp(session) : $("#tela-login").classList.remove("hidden");
}

$("#form-login").addEventListener("submit", async e=>{
  e.preventDefault();
  const b=$("#btn-entrar"), m=$("#login-msg");
  b.disabled=true; m.className="msg"; m.textContent="Entrando…";
  const { data, error } = await sb.auth.signInWithPassword({ email:$("#l-email").value.trim(), password:$("#l-senha").value });
  b.disabled=false;
  if(error){ m.className="msg err"; m.textContent=erroAmigavel(error); return; }
  m.textContent=""; entrarNoApp(data.session);
});

async function entrarNoApp(session){
  const { data:ok, error } = await sb.rpc("site_is_admin");
  if(error || !ok){
    await sb.auth.signOut();
    $("#tela-app").classList.add("hidden"); $("#tela-login").classList.remove("hidden");
    const m=$("#login-msg"); m.className="msg err";
    m.textContent = error ? erroAmigavel(error) : "Este e-mail não está cadastrado como administrador do site.";
    return;
  }
  $("#tela-login").classList.add("hidden"); $("#tela-app").classList.remove("hidden");
  $("#who").textContent = session.user.email;
  trocarAba("artigos");
}
$("#btn-sair").addEventListener("click", async ()=>{ if(!confirmarSaida()) return; sujo=false; await sb.auth.signOut(); location.reload(); });

/* ---------- Abas e lista ---------- */
$("#tabs").addEventListener("click", e=>{ const b=e.target.closest("[data-tab]"); if(b) trocarAba(b.dataset.tab); });

function trocarAba(t){
  if(!confirmarSaida()) return;
  aba=t; atual=null; sujo=false;
  document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected", b.dataset.tab===t));
  if(t==="config"){ $("#lista-panel").classList.add("hidden"); abrirConfig(); return; }
  if(t==="inscritos"){ $("#lista-panel").classList.add("hidden"); abrirInscritos(); return; }
  $("#lista-panel").classList.remove("hidden");
  $("#lista-titulo").textContent = ENT[t].nome;
  $("#editor").innerHTML = `<p class="empty">Escolha um item da lista ou clique em <strong>+ Novo</strong>.</p>`;
  carregarLista();
}

async function carregarLista(){
  const E=ENT[aba];
  $("#lista").innerHTML = `<p class="empty">Carregando…</p>`;
  let q = sb.from(E.tabela).select("*");
  for(const [col,asc] of E.ordem) q=q.order(col,{ascending:asc});
  const { data, error } = await q;
  if(error){ $("#lista").innerHTML = `<p class="msg err">${esc(erroAmigavel(error))}</p>`; return; }
  linhas = data;
  if(!data.length){
    $("#lista").innerHTML = `<div class="empty">Nada cadastrado ainda.<br><br><button class="btn ghost" data-goto="config">Importar conteúdo de exemplo</button></div>`;
    return;
  }
  $("#lista").innerHTML = data.map(r=>`
    <button class="item" data-id="${r.id}" aria-current="${atual&&atual.id===r.id}">
      <strong>${esc(E.titulo(r))}</strong>
      <span class="pill ${r.publicado?"on":"off"}">${r.publicado?"Publicado":"Rascunho"}</span>
      <span class="sub">${esc(E.sub(r))}</span>
    </button>`).join("");
}
$("#lista").addEventListener("click", e=>{
  const g=e.target.closest("[data-goto]"); if(g){ trocarAba(g.dataset.goto); return; }
  const b=e.target.closest(".item"); if(!b) return;
  if(!confirmarSaida()) return;
  abrirEditor(linhas.find(r=>r.id===b.dataset.id));
  document.querySelectorAll(".item").forEach(i=>i.setAttribute("aria-current", i===b));
  if(innerWidth<900) $("#editor").scrollIntoView({behavior:"smooth"});
});
$("#btn-novo").addEventListener("click", ()=>{
  if(!confirmarSaida()) return;
  document.querySelectorAll(".item").forEach(i=>i.setAttribute("aria-current", false));
  abrirEditor(ENT[aba].novo());
  if(innerWidth<900) $("#editor").scrollIntoView({behavior:"smooth"});
});

/* ---------- Editor ---------- */
function campoHTML(c, v){
  const id="c-"+c.k, help=c.help?`<small>${esc(c.help)}</small>`:"";
  if(c.tipo==="imagem") return imagemHTML(id, c.label, v, c.pasta, c.help);
  if(c.tipo==="check") return `<label class="check" for="${id}"><input type="checkbox" id="${id}" ${v?"checked":""}>${esc(c.label)}</label>`;
  if(c.tipo==="textarea") return `<label class="f" for="${id}">${esc(c.label)}<textarea id="${id}">${esc(v)}</textarea>${help}</label>`;
  if(c.tipo==="select") return `<label class="f" for="${id}">${esc(c.label)}<select id="${id}">${c.opts.map(([val,txt])=>`<option value="${esc(val)}" ${val===v?"selected":""}>${esc(txt)}</option>`).join("")}</select>${help}</label>`;
  if(c.tipo==="rich") return `<div class="f"><span style="font-weight:600;font-size:.9rem">${esc(c.label)}</span>
    <div class="rt"><div class="tb" role="toolbar" aria-label="Formatação">
      <button type="button" data-cmd="h2">Subtítulo</button><button type="button" data-cmd="p">Parágrafo</button>
      <button type="button" data-cmd="bold"><b>N</b></button><button type="button" data-cmd="italic"><i>I</i></button>
      <button type="button" data-cmd="ul">• Lista</button><button type="button" data-cmd="quote">Destaque</button>
      <button type="button" data-cmd="link">Link</button><button type="button" data-cmd="img">Imagem</button><input type="file" class="sr" id="rt-file" accept="image/jpeg,image/png,image/webp,image/gif" tabindex="-1"><button type="button" data-cmd="clear">Limpar formatação</button>
    </div><div class="ed" id="${id}" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Texto do artigo">${limparHTML(v)}</div></div></div>`;
  const lista = c.lista?` list="dl-${c.lista}"`:"";
  return `<label class="f" for="${id}">${esc(c.label)}<input type="${c.tipo}" id="${id}" value="${esc(v)}"${lista} ${c.req?"required":""}>${help}</label>`;
}

function abrirEditor(row){
  const E=ENT[aba]; atual={...row}; slugManual=!!row.id;
  const camposPorK = Object.fromEntries(E.campos.filter(c=>typeof c.k==="string").map(c=>[c.k,c]));
  const usados=new Set(); let html="";
  for(const c of E.campos){
    if(Array.isArray(c.k)){ html+=`<div class="row2">${c.k.map(k=>{usados.add(k);return campoHTML(camposPorK[k],row[k]);}).join("")}</div>`; }
    else if(!usados.has(c.k)) html+=campoHTML(c,row[c.k]);
  }
  const cats=[...new Set(linhas.map(r=>r.categoria).filter(Boolean).concat(["Método","Memorização","Edital","Rotina","Disciplinas","Notícias"]))];
  const tipos=[...new Set(linhas.map(r=>r.tipo).filter(Boolean).concat(["Resumos","Mapas mentais","Questões","Kits","Planners"]))];
  const aviso = aba==="concursos" && row.origem==="folha"
    ? `<p class="msg" style="background:color-mix(in srgb,var(--marker) 25%,transparent);padding:10px 12px;border-radius:9px;margin:0 0 12px">Este concurso é atualizado automaticamente pela Folha Dirigida duas vezes por dia: alterações nos campos serão substituídas. Para tirá-lo do site, desmarque <strong>Publicado</strong> e salve (ele continua escondido nas próximas atualizações).</p>` : "";
  $("#editor").innerHTML = aviso + `
    <div class="panel-head"><h3>${row.id?"Editar":"Novo"} · ${E.nome.toLowerCase().replace(/s$/,"")}</h3>
      ${aba==="artigos"&&row.id&&row.publicado?`<a href="index.html?artigo=${encodeURIComponent(row.slug)}" target="_blank" rel="noopener">Ver no site →</a>`:""}</div>
    <form class="form" id="form-ed" novalidate>${html}
      <datalist id="dl-cats">${cats.map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
      <datalist id="dl-tipos">${tipos.map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
      <div class="actions">
        <button class="btn marker" type="submit" id="btn-salvar">Salvar</button>
        ${row.id?`<button class="btn danger" type="button" id="btn-excluir">Excluir</button>`:""}
        <p class="msg" id="ed-msg" aria-live="polite"></p>
      </div>
    </form>`;

  if(aba==="artigos"){
    const t=$("#c-titulo"), s=$("#c-slug");
    t.addEventListener("input", ()=>{ if(!slugManual) s.value=slugify(t.value); });
    s.addEventListener("input", ()=>{ slugManual=true; });
    ligarEditorTexto();
  }
  ligarImagens($("#editor"));
  $("#form-ed").addEventListener("submit", salvar);
  sujo=false;
  $("#form-ed").addEventListener("input", ()=>{ sujo=true; });
  const bx=$("#btn-excluir");
  if(bx) bx.addEventListener("click", ()=>{
    if(!bx.classList.contains("armed")){ bx.classList.add("armed"); bx.textContent="Clique de novo para excluir"; setTimeout(()=>{bx.classList.remove("armed");bx.textContent="Excluir";},4000); return; }
    excluir();
  });
}

function ligarEditorTexto(){
  const ed=$("#c-corpo");
  document.execCommand("defaultParagraphSeparator", false, "p");
  $(".rt .tb").addEventListener("mousedown", e=>{ if(e.target.closest("button")) e.preventDefault(); });
  $(".rt .tb").addEventListener("click", e=>{
    const b=e.target.closest("[data-cmd]"); if(!b) return; ed.focus();
    const c=b.dataset.cmd;
    if(c==="h2"||c==="p") document.execCommand("formatBlock", false, c);
    else if(c==="quote") document.execCommand("formatBlock", false, "blockquote");
    else if(c==="ul") document.execCommand("insertUnorderedList");
    else if(c==="bold"||c==="italic") document.execCommand(c);
    else if(c==="clear"){ document.execCommand("removeFormat"); document.execCommand("formatBlock", false, "p"); }
    else if(c==="img"){
      const sel=getSelection();
      rangeSalvo = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
      $("#rt-file").click();
    }
    else if(c==="link"){
      const url = (window.prompt("Cole o endereço do link (https://...)")||"").trim();
      if(!url) return;
      if(!/^(https?:\/\/|mailto:|#|\?artigo=)/i.test(url)){ toast("Use um endereço que comece com https://"); return; }
      document.execCommand("createLink", false, url);
    }
  });
  $("#rt-file").addEventListener("change", async ()=>{
    const f=$("#rt-file").files[0]; $("#rt-file").value=""; if(!f) return;
    toast("Enviando imagem…");
    try{
      const url = await enviarImagem(f, "artigos");
      const alt = window.prompt("Descreva a imagem em poucas palavras (ajuda no Google e na acessibilidade):","") || "";
      ed.focus();
      const sel=getSelection();
      if(rangeSalvo){ sel.removeAllRanges(); sel.addRange(rangeSalvo); }
      else { const r=document.createRange(); r.selectNodeContents(ed); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
      document.execCommand("insertHTML", false, `<p><img src="${esc(url)}" alt="${esc(alt)}"></p><p><br></p>`);
      toast("Imagem inserida. Clique em Salvar para gravar o artigo.");
    }catch(err){ toast(erroAmigavel(err)); }
  });
  ed.addEventListener("paste", e=>{
    e.preventDefault();
    const cd=e.clipboardData||window.clipboardData;
    let html="";
    const rico=cd.getData("text/html");
    if(rico && rico.trim()){ try{ html=limparColado(rico); }catch(err){ html=""; } }
    if(!html){
      const txt=cd.getData("text/plain");
      html=txt.split(/\n\s*\n|\r\n\s*\r\n/).map(p=>"<p>"+esc(p.trim()).replace(/\n/g,"<br>")+"</p>").join("");
    }
    document.execCommand("insertHTML", false, html);
  });
}

/* Colar com formatação: mantém subtítulos, negrito, itálico, listas, links, tabelas e imagens.
   Remove fontes, cores, classes e qualquer script vindos do Word, Google Docs ou de outros sites. */
function limparColado(bruto){
  const doc=new DOMParser().parseFromString(bruto,"text/html");
  const MANTER=new Set(["P","H2","H3","H4","STRONG","EM","U","S","UL","OL","LI","A","BLOCKQUOTE","TABLE","THEAD","TBODY","TR","TH","TD","IMG","FIGURE","FIGCAPTION","BR","HR","CODE","PRE","SUB","SUP"]);
  const TROCA={H1:"H2",B:"STRONG",I:"EM",H5:"H4",H6:"H4"};
  const ATRIB={A:["href"],IMG:["src","alt"],TD:["colspan","rowspan","style"],TH:["colspan","rowspan","style"],TABLE:["style"],FIGURE:["style"],FIGCAPTION:["style"]};
  const PROIBIDAS=["SCRIPT","STYLE","META","LINK","TITLE","IFRAME","OBJECT","EMBED","NOSCRIPT","FORM","INPUT","BUTTON"];
  const tratar=no=>{
    if(no.nodeType===3) return document.createTextNode(no.textContent);
    if(no.nodeType!==1) return null;
    let tag=no.tagName.toUpperCase();
    if(PROIBIDAS.includes(tag)) return null;
    if(tag==="SVG"){
      const s=document.importNode(no,true);
      s.querySelectorAll("script,foreignObject").forEach(x=>x.remove());
      [s,...s.querySelectorAll("*")].forEach(el=>[...el.attributes].forEach(a=>{ if(/^on/i.test(a.name)||/javascript:/i.test(a.value)) el.removeAttribute(a.name); }));
      return s;
    }
    const filhos=()=>{ const f=document.createDocumentFragment(); no.childNodes.forEach(c=>{ const r=tratar(c); if(r) f.appendChild(r); }); return f; };
    const st=(no.getAttribute("style")||"").toLowerCase();
    if(tag==="SPAN"){
      let f=filhos();
      if(/font-weight:\s*(bold|[6-9]00)/.test(st)){ const b=document.createElement("strong"); b.appendChild(f); f=b; }
      if(/font-style:\s*italic/.test(st)){ const i=document.createElement("em"); i.appendChild(f); f=i; }
      return f;
    }
    if(tag==="B" && /font-weight:\s*normal/.test(st)) return filhos();
    if(tag==="DIV"){ if(no.querySelector("p,h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,div,figure,svg,pre")) return filhos(); tag="P"; }
    tag=TROCA[tag]||tag;
    if(!MANTER.has(tag)) return filhos();
    const el=document.createElement(tag);
    (ATRIB[tag]||[]).forEach(n=>{ const v=no.getAttribute(n); if(v && !/javascript:|expression\(/i.test(v)) el.setAttribute(n,v); });
    el.appendChild(filhos());
    return el;
  };
  const caixa=document.createElement("div");
  doc.body.childNodes.forEach(c=>{ const r=tratar(c); if(r) caixa.appendChild(r); });
  const BLOCO=/^(P|H2|H3|H4|UL|OL|BLOCKQUOTE|TABLE|FIGURE|HR|PRE|SVG)$/i;
  const saida=document.createElement("div"); let p=null;
  [...caixa.childNodes].forEach(n=>{
    if(n.nodeType===1 && BLOCO.test(n.nodeName)){ p=null; saida.appendChild(n); return; }
    if(n.nodeType===3 && !n.textContent.trim()){ if(p) p.appendChild(n); return; }
    if(!p){ p=document.createElement("p"); saida.appendChild(p); }
    p.appendChild(n);
  });
  saida.querySelectorAll("p,li,h2,h3,h4").forEach(x=>{ if(!x.textContent.trim() && !x.querySelector("img,svg")) x.remove(); });
  return saida.innerHTML.trim();
}

function lerForm(){
  const E=ENT[aba], out={};
  for(const c of E.campos){
    if(Array.isArray(c.k)) continue;
    const el=document.getElementById("c-"+c.k);
    if(c.tipo==="check") out[c.k]=el.checked;
    else if(c.tipo==="rich") out[c.k]=el.innerHTML.replace(/<div>/g,"<p>").replace(/<\/div>/g,"</p>");
    else if(c.tipo==="number") out[c.k]=parseInt(el.value||"0",10);
    else if(c.tipo==="imagem") out[c.k]=el.value;
    else out[c.k]=el.value.trim();
  }
  if(aba==="artigos"){
    out.slug=slugify(out.slug||out.titulo);
    const palavras=$("#c-corpo").innerText.trim().split(/\s+/).filter(Boolean).length;
    out.minutos=Math.max(1, Math.ceil(palavras/200));
  }
  return out;
}

async function salvar(e){
  e.preventDefault();
  const m=$("#ed-msg"), b=$("#btn-salvar"), E=ENT[aba];
  const dados=lerForm();
  const faltando=E.campos.filter(c=>c.req && !dados[c.k]).map(c=>c.label);
  if(faltando.length){ m.className="msg err"; m.textContent="Preencha: "+faltando.join(", ")+"."; return; }
  b.disabled=true; m.className="msg"; m.textContent="Salvando…";
  const q = atual.id ? sb.from(E.tabela).update(dados).eq("id",atual.id).select().single()
                     : sb.from(E.tabela).insert(dados).select().single();
  const { data, error } = await q;
  b.disabled=false;
  if(error){ m.className="msg err"; m.textContent=erroAmigavel(error); return; }
  sujo=false;
  toast(dados.publicado ? "Salvo e publicado no site." : "Salvo como rascunho.");
  await carregarLista();
  abrirEditor(data);
  document.querySelectorAll(".item").forEach(i=>i.setAttribute("aria-current", i.dataset.id===data.id));
}

async function excluir(){
  sujo=false;
  const { error } = await sb.from(ENT[aba].tabela).delete().eq("id",atual.id);
  if(error){ $("#ed-msg").className="msg err"; $("#ed-msg").textContent=erroAmigavel(error); return; }
  toast("Excluído.");
  trocarAba(aba);
}

/* ---------- Imagens ---------- */
let rangeSalvo=null;
const TIPOS_IMG=["image/jpeg","image/png","image/webp","image/gif"];
function imagemHTML(id,label,v,pasta,help){
  return `<div class="f img-field" data-img="${id}" data-pasta="${esc(pasta)}">
    <span class="lbl">${esc(label)}</span>
    <div class="img-box"><img alt="" src="${esc(v||"")}" class="${v?"":"hidden"}"><span class="ph ${v?"hidden":""}">Nenhuma imagem</span></div>
    <div class="img-actions">
      <label class="btn ghost small" for="f-${id}">Escolher imagem</label>
      <input type="file" class="sr" id="f-${id}" accept="image/jpeg,image/png,image/webp,image/gif">
      <button type="button" class="btn ghost small rm">Remover</button>
    </div>
    <input type="hidden" id="${id}" value="${esc(v||"")}">
    ${help?`<small>${esc(help)}</small>`:""}
    <p class="msg" aria-live="polite"></p>
  </div>`;
}
function ligarImagens(root){
  root.querySelectorAll("[data-img]").forEach(box=>{
    const hid=document.getElementById(box.dataset.img), file=box.querySelector("input[type=file]"),
          img=box.querySelector("img"), ph=box.querySelector(".ph"), msg=box.querySelector(".msg");
    const mostrar=u=>{ hid.value=u; if(u) img.src=u; img.classList.toggle("hidden",!u); ph.classList.toggle("hidden",!!u); };
    file.addEventListener("change", async ()=>{
      const f=file.files[0]; file.value=""; if(!f) return;
      msg.className="msg"; msg.textContent="Enviando imagem…";
      try{ mostrar(await enviarImagem(f, box.dataset.pasta)); msg.className="msg ok"; msg.textContent="Imagem enviada. Clique em Salvar para gravar."; }
      catch(e){ msg.className="msg err"; msg.textContent=erroAmigavel(e); }
    });
    box.querySelector(".rm").addEventListener("click", ()=>{ mostrar(""); msg.className="msg"; msg.textContent="Imagem removida. Clique em Salvar para gravar."; });
  });
}
function paraBlob(canvas,tipo,q){ return new Promise(r=>canvas.toBlob(r,tipo,q)); }
async function comprimir(file, max=1600){
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max/Math.max(bmp.width,bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width*s); c.height = Math.round(bmp.height*s);
  c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);
  let b = await paraBlob(c,"image/webp",0.82);
  if(!b || b.type!=="image/webp") b = await paraBlob(c,"image/jpeg",0.85);
  return b;
}
async function enviarImagem(file, pasta){
  if(!TIPOS_IMG.includes(file.type)) throw new Error("Escolha uma imagem JPG, PNG, WebP ou GIF.");
  let blob = file;
  if(file.type!=="image/gif"){ try{ blob = await comprimir(file); }catch(e){ blob = file; } }
  if(blob.size > 5*1024*1024) throw new Error("Imagem muito grande. O limite é 5 MB.");
  const ext = {"image/webp":"webp","image/jpeg":"jpg","image/png":"png","image/gif":"gif"}[blob.type] || "jpg";
  const nome = `${pasta}/${Date.now()}-${slugify(file.name.replace(/\.[^.]+$/,"")).slice(0,40)||"imagem"}.${ext}`;
  const { error } = await sb.storage.from("site-imagens").upload(nome, blob, { contentType: blob.type, cacheControl: "31536000" });
  if(error) throw error;
  return sb.storage.from("site-imagens").getPublicUrl(nome).data.publicUrl;
}

/* ---------- Newsletter ---------- */
async function abrirInscritos(){
  $("#editor").innerHTML = `<p class="empty">Carregando…</p>`;
  const { data, error } = await sb.from("site_newsletter").select("id,email,criado_em").order("criado_em",{ascending:false});
  if(error){ $("#editor").innerHTML=`<p class="msg err">${esc(erroAmigavel(error))}</p>`; return; }
  $("#editor").innerHTML = `
    <div class="panel-head"><h3>Inscritos na newsletter (${data.length})</h3>
      ${data.length?`<button class="btn marker small" id="btn-csv">Baixar planilha (CSV)</button>`:""}</div>
    <p style="color:var(--muted);margin-top:0">E-mails cadastrados pelo formulário do site. Importe a planilha no seu serviço de e-mail (Brevo, Mailchimp, MailerLite…). Para atender um pedido de descadastro, exclua o e-mail aqui.</p>
    ${data.length ? `<div class="list">${data.map(r=>`
      <div class="item" style="cursor:default"><strong>${esc(r.email)}</strong>
        <button class="btn danger small" data-del="${esc(r.id)}" type="button">Excluir</button>
        <span class="sub">${new Date(r.criado_em).toLocaleString("pt-BR")}</span></div>`).join("")}</div>`
      : `<p class="empty">Ninguém se inscreveu ainda.</p>`}`;
  $("#btn-csv")?.addEventListener("click", ()=>{
    const csv = "email,inscrito_em\n" + data.map(r=>`${r.email},${r.criado_em}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download = `newsletter-${hoje()}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  });
  $("#editor").querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", async ()=>{
    if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Confirmar"; setTimeout(()=>{b.classList.remove("armed");b.textContent="Excluir";},4000); return; }
    const { error } = await sb.from("site_newsletter").delete().eq("id", b.dataset.del);
    if(error){ toast(erroAmigavel(error)); return; }
    toast("E-mail removido."); abrirInscritos();
  }));
}

/* ---------- Configurações ---------- */
async function abrirConfig(){
  $("#editor").innerHTML = `<p class="empty">Carregando…</p>`;
  const { data, error } = await sb.from("site_config").select("*");
  if(error){ $("#editor").innerHTML=`<p class="msg err">${esc(erroAmigavel(error))}</p>`; return; }
  const cfg=Object.fromEntries(data.map(r=>[r.chave,r.valor]));
  $("#editor").innerHTML = `
    <div class="panel-head"><h3>Configurações do site</h3></div>
    <form class="form" id="form-cfg">
      <label class="f" for="k-checkout_mesa_mensal">Link de pagamento · Mesa de Estudos mensal<input type="url" id="k-checkout_mesa_mensal" value="${esc(cfg.checkout_mesa_mensal)}"></label>
      <label class="f" for="k-checkout_mesa_anual">Link de pagamento · Mesa de Estudos anual<input type="url" id="k-checkout_mesa_anual" value="${esc(cfg.checkout_mesa_anual)}"></label>
      <label class="f" for="k-email_contato">E-mail de contato (página Sobre)<input type="email" id="k-email_contato" value="${esc(cfg.email_contato)}"></label>
      ${imagemHTML("k-foto_sobre","Sua foto (página Sobre)",cfg.foto_sobre||"","geral","Uma foto quadrada fica melhor. Ela aparece redonda.")}
      <div class="actions"><button class="btn marker" type="submit">Salvar configurações</button><p class="msg" id="cfg-msg" aria-live="polite"></p></div>
    </form>
    <div style="margin-top:28px;border-top:1px solid var(--line);padding-top:18px">
      <h3>Conteúdo de exemplo</h3>
      <p style="color:var(--muted)">Copia para o banco os 6 artigos, 6 concursos e 6 materiais de exemplo, para você editar em vez de começar do zero. Artigos com o mesmo endereço não são duplicados; concursos e materiais só são importados se a lista estiver vazia.</p>
      <button class="btn ghost" id="btn-importar">Importar conteúdo de exemplo</button>
      <p class="msg" id="imp-msg" aria-live="polite"></p>
    </div>`;
  ligarImagens($("#editor"));
  $("#form-cfg").addEventListener("submit", async e=>{
    e.preventDefault();
    const linhasCfg=["checkout_mesa_mensal","checkout_mesa_anual","email_contato","foto_sobre"].map(k=>({chave:k,valor:$("#k-"+k).value.trim()}));
    const { error } = await sb.from("site_config").upsert(linhasCfg);
    const m=$("#cfg-msg"); m.className = error?"msg err":"msg ok"; m.textContent = error?erroAmigavel(error):"Configurações salvas.";
  });
  $("#btn-importar").addEventListener("click", importarExemplos);
}

async function importarExemplos(){
  const m=$("#imp-msg"), b=$("#btn-importar"), ex=window.DADOS_EXEMPLO;
  b.disabled=true; m.className="msg"; m.textContent="Importando…";
  try{
    let r = await sb.from("site_artigos").upsert(ex.artigos, { onConflict:"slug", ignoreDuplicates:true });
    if(r.error) throw r.error;
    for(const [tab,lista] of [["site_concursos",ex.concursos],["site_produtos",ex.produtos.map(({id,...p})=>p)]]){
      const { count, error } = await sb.from(tab).select("id",{count:"exact",head:true});
      if(error) throw error;
      if(!count){ r = await sb.from(tab).insert(lista); if(r.error) throw r.error; }
    }
    m.className="msg ok"; m.textContent="Pronto! Confira as abas Artigos, Concursos e Materiais.";
  }catch(e){ m.className="msg err"; m.textContent=erroAmigavel(e); }
  b.disabled=false;
}

iniciar();
