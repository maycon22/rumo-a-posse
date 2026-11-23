/* Rumo à Posse · painel: editais lidos pela IA e revisão dos planos de estudo da Mesa de Estudos.
   Fluxo: a função "ler-editais" acha o PDF, lê o conteúdo programático e a IA monta um plano por cargo.
   Aqui você confere cada plano e aprova: só os aprovados aparecem em "Planos e concursos" no app. */
const ED_STATUS = {
  procurar: ["Procurando o PDF", "off"], sem_pdf: ["Falta o PDF", "err"], ler: ["Lendo o PDF", "off"],
  aguardando_ia: ["Aguardando a chave da IA", "warn"], cargos: ["IA: lendo os cargos", "off"], extrair: ["IA montando os planos", "off"],
  revisar: ["Para revisar", "warn"], erro: ["Erro", "err"], ignorado: ["Ignorado", "off"],
};
const ORDEM_ED = { revisar: 0, sem_pdf: 1, erro: 2, aguardando_ia: 3, extrair: 4, cargos: 5, ler: 6, procurar: 7, ignorado: 9 };
let EDT_LISTA = [], EDT_CONC = {}, EDT_ATUAL = null;

const pillEd = (st, extra = "") => { const [t, c] = ED_STATUS[st] || [st, "off"]; return `<span class="pill ${c}">${esc(t)}${extra}</span>`; };
const nomeConc = c => c ? `${c.orgao}${c.cargo && c.cargo !== "A definir" ? " · " + c.cargo : ""}` : "(concurso fora do site)";

async function carregarEditais() {
  $("#lista").innerHTML = `<p class="empty">Carregando…</p>`;
  const [e, p] = await Promise.all([
    sb.from("site_editais").select("id,concurso_chave,status,pdf_url,pdf_titulo,mensagem,custo_usd,atualizado_em,cargos").order("atualizado_em", { ascending: false }),
    sb.from("site_editais_planos").select("edital_id,status"),
  ]);
  if (e.error || p.error) { $("#lista").innerHTML = `<p class="msg err">${esc(erroAmigavel(e.error || p.error))}</p>`; return; }
  const chaves = [...new Set(e.data.map(x => x.concurso_chave))];
  const { data: cs } = chaves.length ? await sb.from("site_concursos").select("chave,orgao,orgao_nome,cargo,banca,situacao,provas,links_banca,fonte_url").in("chave", chaves) : { data: [] };
  EDT_CONC = Object.fromEntries((cs || []).map(c => [c.chave, c]));
  const contagem = {}; for (const x of p.data) { const k = contagem[x.edital_id] ||= { revisar: 0, aprovado: 0, rejeitado: 0 }; k[x.status]++; }
  EDT_LISTA = e.data.map(x => ({ ...x, planos: contagem[x.id] || { revisar: 0, aprovado: 0, rejeitado: 0 } }))
    .sort((a, b) => (ORDEM_ED[a.status] ?? 8) - (ORDEM_ED[b.status] ?? 8) || String(b.atualizado_em).localeCompare(a.atualizado_em));
  const revisar = EDT_LISTA.reduce((s, x) => s + x.planos.revisar, 0), gasto = EDT_LISTA.reduce((s, x) => s + Number(x.custo_usd || 0), 0);
  $("#lista").innerHTML = (EDT_LISTA.length ? `<p style="margin:0 0 6px;color:var(--muted);font-size:.88rem">${revisar ? `<strong style="color:var(--ink)">${revisar} plano(s) para revisar.</strong> ` : ""}Gasto com IA até agora: US$ ${gasto.toFixed(2)}.</p>` : "")
    + (EDT_LISTA.map(x => `<button class="item" data-ed="${esc(x.id)}" aria-current="${EDT_ATUAL === x.id}">
        <strong>${esc(nomeConc(EDT_CONC[x.concurso_chave]))}</strong>${pillEd(x.status)}
        <span class="sub">${x.planos.aprovado ? `${x.planos.aprovado} aprovado(s) · ` : ""}${x.planos.revisar ? `${x.planos.revisar} para revisar · ` : ""}${esc(x.mensagem || (x.pdf_titulo ? "PDF: " + x.pdf_titulo : ""))}</span>
      </button>`).join("") || `<div class="empty">Nenhum edital na fila ainda. Os concursos com edital publicado entram sozinhos na próxima execução (a cada 10 minutos).</div>`);
}

async function processarEditaisAgora(silencioso) {
  const b = $("#btn-novo"); b.disabled = true;
  const { error } = await sb.functions.invoke("ler-editais", { body: {} });
  b.disabled = false;
  if (error) { toast("Não consegui iniciar: " + erroAmigavel(error)); return; }
  if (!silencioso) toast("Processando. A lista se atualiza em alguns segundos.");
  setTimeout(async () => { await carregarEditais(); if (EDT_ATUAL) abrirEdital(EDT_ATUAL); }, 8000);
}

/* Texto editável de um plano: "# Disciplina", "- tópico", "  - subtópico" */
const planoParaTexto = ds => ds.map(d => `# ${d.nome}\n` + d.topicos.map(t => `- ${typeof t === "string" ? t : t.t}` + ((t.sub || []).length ? "\n" + t.sub.map(s => `  - ${s}`).join("\n") : "")).join("\n")).join("\n\n");
function textoParaPlano(txt) {
  const ds = []; let d = null, t = null;
  for (const bruta of String(txt).split(/\r?\n/)) {
    const l = bruta.replace(/\s+$/, ""); if (!l.trim()) continue;
    const h = /^#\s*(.+)$/.exec(l.trim()); if (h) { d = { nome: h[1].trim().slice(0, 150), topicos: [] }; ds.push(d); t = null; continue; }
    const sub = /^\s{2,}[-•*]\s*(.+)$/.exec(l), top = /^[-•*]\s*(.+)$/.exec(l.trim());
    if (!d) throw new Error("Comece cada disciplina com # (ex.: # Língua Portuguesa).");
    if (sub && t) { t.sub.push(sub[1].trim().slice(0, 400)); continue; }
    t = { t: (top ? top[1] : l).trim().slice(0, 600), sub: [] }; d.topicos.push(t);
  }
  const ok = ds.filter(x => x.nome && x.topicos.length);
  if (!ok.length) throw new Error("O plano ficou vazio.");
  return ok;
}

async function abrirEdital(id) {
  EDT_ATUAL = id;
  document.querySelectorAll("#lista [data-ed]").forEach(i => i.setAttribute("aria-current", i.dataset.ed === id));
  $("#editor").innerHTML = `<p class="empty">Carregando…</p>`;
  const [{ data: ed, error }, { data: planos, error: e2 }] = await Promise.all([
    sb.from("site_editais").select("*").eq("id", id).single(),
    sb.from("site_editais_planos").select("*").eq("edital_id", id).order("cargo"),
  ]);
  if (error || e2) { $("#editor").innerHTML = `<p class="msg err">${esc(erroAmigavel(error || e2))}</p>`; return; }
  const c = EDT_CONC[ed.concurso_chave] || {};
  const cargos = (ed.cargos || []).map(x => `<li>${esc(x.nome)}: ${x.status === "feito" ? "pronto" : x.status === "pendente" ? "na fila da IA" : x.status === "vazio" ? "sem conteúdo no edital" : "erro" + (x.erro ? " (" + esc(x.erro) + ")" : "")}</li>`).join("");
  $("#editor").innerHTML = `
    <div class="panel-head"><h3>${esc(c.orgao_nome || c.orgao || ed.concurso_chave)}</h3>${pillEd(ed.status)}</div>
    <p style="margin:0 0 6px;color:var(--muted)">${esc([c.cargo, c.banca, c.provas ? "prova: " + c.provas : ""].filter(x => x && x !== "A definir").join(" · "))}</p>
    ${ed.mensagem ? `<p class="msg ${ed.status === "erro" || ed.status === "sem_pdf" ? "err" : ""}" style="margin:6px 0 12px">${esc(ed.mensagem)}</p>` : ""}
    <div class="form">
      <div><strong>PDF do edital</strong><br>${ed.pdf_url ? `<a href="${esc(ed.pdf_url)}" target="_blank" rel="noopener noreferrer">${esc(ed.pdf_titulo || ed.pdf_url)}</a> <span style="color:var(--muted);font-size:.85rem">(${ed.pdf_origem === "manual" ? "escolhido por você" : "achado automaticamente"}${ed.paginas ? `, ${ed.paginas} páginas` : ""})</span>` : `<span style="color:var(--muted)">ainda não definido</span>`}</div>
      ${(ed.candidatos || []).length ? `<details><summary style="cursor:pointer;font-weight:600">Outros PDFs encontrados (${ed.candidatos.length})</summary><div class="list" style="margin-top:8px">${ed.candidatos.map((x, i) => `
        <div class="item" style="cursor:default"><span><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.titulo || x.url)}</a> <span style="color:var(--muted);font-size:.8rem">${esc(x.fonte || "")}</span></span>
        <button class="btn ghost small" type="button" data-usar="${i}">Usar este</button></div>`).join("")}</div></details>` : ""}
      <div class="row2" style="align-items:end"><label class="f">Colar o link do PDF do edital<input type="url" id="ed-pdf" placeholder="https://…/edital.pdf"></label><button class="btn ghost" type="button" id="ed-ler">Ler este PDF</button></div>
      <details><summary style="cursor:pointer;font-weight:600">O PDF é escaneado ou não abre? Cole o texto do conteúdo programático</summary>
        <label class="f" style="margin-top:8px">Texto do conteúdo programático (copie do PDF)<textarea id="ed-texto" style="min-height:160px"></textarea></label>
        <button class="btn ghost small" type="button" id="ed-usar-texto" style="margin-top:8px">Mandar este texto para a IA</button></details>
      ${cargos ? `<div><strong>Cargos</strong><ul style="margin:6px 0 0;padding-left:20px">${cargos}</ul></div>` : ""}
      <div class="actions">
        <button class="btn ghost small" type="button" id="ed-procurar">Procurar o PDF de novo</button>
        ${ed.status === "ignorado" ? `<button class="btn ghost small" type="button" id="ed-reativar">Voltar a acompanhar</button>` : `<button class="btn danger small" type="button" id="ed-ignorar">Ignorar este edital</button>`}
        <span style="color:var(--muted);font-size:.85rem;margin-left:auto">IA: US$ ${Number(ed.custo_usd || 0).toFixed(2)} · ${Number(ed.tokens_entrada || 0).toLocaleString("pt-BR")} tokens lidos</span>
      </div>
      ${ed.texto ? `<details><summary style="cursor:pointer;font-weight:600">Ver o texto lido do PDF (${ed.texto.length.toLocaleString("pt-BR")} caracteres)</summary><pre style="white-space:pre-wrap;max-height:360px;overflow:auto;background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:10px;font-size:.82rem">${esc(ed.texto.slice(0, 60000))}${ed.texto.length > 60000 ? "\n…" : ""}</pre></details>` : ""}
    </div>
    <h3 style="margin:22px 0 10px">Planos (${planos.length})</h3>
    ${planos.length ? planos.map(cartaoPlanoEd).join("") : `<p class="empty" style="padding:14px">Os planos aparecem aqui quando a IA terminar.</p>`}`;
  ligarEdital(ed, planos);
}

function cartaoPlanoEd(p) {
  const pct = p.info?.conferencia_pct, st = { revisar: ["Para revisar", "warn"], aprovado: ["Aprovado: aparece no app", "on"], rejeitado: ["Rejeitado", "off"] }[p.status];
  return `<div class="panel" style="padding:14px;margin-bottom:10px" data-plano="${esc(p.id)}">
    <div class="panel-head" style="margin-bottom:6px"><strong>${esc(p.cargo)}</strong><span class="pill ${st[1]}">${st[0]}</span></div>
    <p style="margin:0 0 8px;color:var(--muted);font-size:.88rem">${p.n_disciplinas} disciplinas · ${p.n_topicos} tópicos${pct != null ? ` · <span style="color:${pct < 85 ? "var(--danger)" : "var(--ok)"};font-weight:700">${pct}% dos tópicos encontrados no texto do edital</span>` : ""}${p.gerado_por === "ia" ? " · gerado por IA" : ""}</p>
    ${pct != null && pct < 85 ? `<p class="msg err" style="margin:0 0 8px">Confira com atenção: parte dos tópicos não foi achada igual no edital (pode ser só diferença de escrita, ou erro da IA).</p>` : ""}
    <details><summary style="cursor:pointer;font-weight:600">Conferir e editar</summary>
      <p style="color:var(--muted);font-size:.85rem;margin:8px 0">Uma disciplina por linha com <strong>#</strong>, um tópico por linha com <strong>-</strong> e subtópicos com dois espaços antes do <strong>-</strong>.</p>
      <textarea data-texto style="min-height:320px;font-family:ui-monospace,Consolas,monospace;font-size:.85rem">${esc(planoParaTexto(p.disciplinas))}</textarea>
      <label class="f" style="margin-top:8px">Nome do cargo<input type="text" data-cargo value="${esc(p.cargo)}" maxlength="300"></label>
    </details>
    <div class="actions" style="margin-top:10px">
      ${p.status !== "aprovado" ? `<button class="btn marker small" type="button" data-acao="aprovado">Aprovar e publicar no app</button>` : `<button class="btn ghost small" type="button" data-acao="revisar">Tirar do app</button>`}
      <button class="btn ghost small" type="button" data-acao="salvar">Salvar alterações</button>
      ${p.status !== "rejeitado" ? `<button class="btn danger small" type="button" data-acao="rejeitado">Rejeitar</button>` : ""}
    </div></div>`;
}

function ligarEdital(ed, planos) {
  const atualizar = async (campos, msg) => {
    const { error } = await sb.from("site_editais").update(campos).eq("id", ed.id);
    if (error) { toast(erroAmigavel(error)); return false; }
    toast(msg); await carregarEditais(); await abrirEdital(ed.id); return true;
  };
  $("#editor").querySelectorAll("[data-usar]").forEach(b => b.addEventListener("click", async () => {
    const x = ed.candidatos[+b.dataset.usar];
    if (await atualizar({ pdf_url: x.url, pdf_titulo: x.titulo || "", pdf_origem: "manual", status: "ler", texto: "", cargos: [], lote_id: "", tentativas: 0, mensagem: "Na fila para ler o PDF escolhido." }, "PDF escolhido. Lendo…")) processarEditaisAgora(true);
  }));
  $("#ed-ler").addEventListener("click", async () => {
    const u = $("#ed-pdf").value.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { toast("Cole um link que comece com https://"); $("#ed-pdf").focus(); return; }
    if (await atualizar({ pdf_url: u, pdf_titulo: "", pdf_origem: "manual", status: "ler", texto: "", cargos: [], lote_id: "", tentativas: 0, mensagem: "Na fila para ler o PDF informado." }, "Link salvo. Lendo o PDF…")) processarEditaisAgora(true);
  });
  $("#ed-usar-texto").addEventListener("click", async () => {
    const t = $("#ed-texto").value.trim();
    if (t.length < 300) { toast("Cole o conteúdo programático completo (o texto está curto demais)."); return; }
    if (await atualizar({ texto: t.slice(0, 400000), status: "cargos", cargos: [], lote_id: "", tentativas: 0, mensagem: "Texto colado por você. Na fila da IA." }, "Texto enviado para a IA.")) processarEditaisAgora(true);
  });
  $("#ed-procurar").addEventListener("click", async () => {
    if (await atualizar({ status: "procurar", pdf_url: "", pdf_titulo: "", pdf_origem: "", candidatos: [], texto: "", cargos: [], lote_id: "", tentativas: 0, mensagem: "" }, "Procurando o PDF de novo…")) processarEditaisAgora(true);
  });
  $("#ed-ignorar")?.addEventListener("click", async e => {
    const b = e.currentTarget;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Confirmar"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Ignorar este edital"; }, 4000); return; }
    atualizar({ status: "ignorado", mensagem: "Ignorado por você." }, "Edital ignorado. Os planos aprovados dele continuam no app.");
  });
  $("#ed-reativar")?.addEventListener("click", () => atualizar({ status: ed.texto ? "cargos" : "procurar", tentativas: 0, mensagem: "" }, "Edital de volta à fila."));
  $("#editor").querySelectorAll("[data-plano]").forEach(card => card.addEventListener("click", async e => {
    const b = e.target.closest("[data-acao]"); if (!b) return;
    const p = planos.find(x => x.id === card.dataset.plano), acao = b.dataset.acao, campos = {};
    const area = card.querySelector("[data-texto]"), cargo = card.querySelector("[data-cargo]").value.trim();
    if (area.value !== planoParaTexto(p.disciplinas) || cargo !== p.cargo) {
      try { campos.disciplinas = textoParaPlano(area.value); } catch (err) { toast(err.message); card.querySelector("details").open = true; area.focus(); return; }
      if (!cargo) { toast("O cargo precisa de um nome."); return; }
      campos.cargo = cargo;
    }
    if (acao !== "salvar") campos.status = acao;
    if (!Object.keys(campos).length) { toast("Nada mudou."); return; }
    b.disabled = true;
    const { error } = await sb.from("site_editais_planos").update(campos).eq("id", p.id);
    b.disabled = false;
    if (error) { toast(erroAmigavel(error)); return; }
    toast({ aprovado: "Aprovado: o plano já aparece no catálogo do app.", revisar: "O plano saiu do app e voltou para revisão.", rejeitado: "Plano rejeitado." }[acao] || "Alterações salvas.");
    await carregarEditais(); await abrirEdital(ed.id);
  }));
}
