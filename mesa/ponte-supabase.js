/* =====================================================================
   Mesa de Estudos · ponte Supabase
   O app (index.html) é o mesmo código do artifact do Claude. Lá ele usa
   window.claude.use("db" | "user" | "downloads"). Aqui esses recursos são
   recriados em cima do Supabase: login, tabela "documentos" com RLS e
   sincronização em tempo real. Para atualizar o app, basta trocar o
   index.html pela versão nova do artifact e rodar o montar-mesa.ps1.
   ===================================================================== */
(() => {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let sb = null, sessao = null, recuperando = false;
  let liberar; const pronto = new Promise(ok => { liberar = ok; });

  /* ---------- tela de login ---------- */
  const AUTH = { tela: "entrar", msg: "", erro: "", ocupado: false };
  const MSG = e => {
    const m = String(e?.message || e || "");
    if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (/already registered|already exists/i.test(m)) return "Já existe uma conta com esse e-mail. Use “Entrar”.";
    if (/Password should be|at least/i.test(m)) return "A senha precisa ter pelo menos 8 caracteres.";
    if (/rate limit|security purposes/i.test(m)) return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
    if (/fetch|network/i.test(m)) return "Sem conexão com o servidor. Confira a internet.";
    return "Não foi possível concluir agora. Tente de novo.";
  };
  function estilo() {
    if ($("#pteEstilo")) return;
    const st = document.createElement("style"); st.id = "pteEstilo";
    st.textContent = `
#pteAuth{position:fixed;inset:0;z-index:100;background:var(--bg,#F2F5F3);color:var(--ink,#16201B);overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:max(40px,6vh) 16px 40px}
#pteAuth .cx{width:min(400px,100%)}
#pteAuth .marca{font-family:var(--f-display,system-ui);font-weight:800;font-size:1.5rem;display:flex;align-items:center;gap:10px;margin-bottom:6px}
#pteAuth .marca i{display:inline-block;width:16px;height:16px;background:var(--mark,#F5DB4C);border-radius:3px;transform:rotate(-8deg)}
#pteAuth .sub{color:var(--muted,#5A6862);margin-bottom:20px}
#pteAuth form{background:var(--surface,#fff);border:1px solid var(--line,#D8E0DB);border-radius:12px;padding:20px;display:grid;gap:12px}
#pteAuth h2{font-family:var(--f-display,system-ui);font-size:1.15rem;margin:0}
#pteAuth label{display:grid;gap:4px;font-size:.82rem;font-weight:600;color:var(--muted,#5A6862)}
#pteAuth input{width:100%;font:inherit;font-size:1rem;color:inherit;background:var(--bg,#F2F5F3);border:1px solid var(--line,#D8E0DB);border-radius:8px;padding:10px 12px}
#pteAuth .ok{min-height:1.2em;font-size:.88rem;margin:0}
#pteAuth .ok.erro{color:var(--bad-ink,#962620)}#pteAuth .ok.bom{color:var(--good-ink,#17603F)}
#pteAuth .acoes{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
#pteAuth .btn-p{font:inherit;font-weight:700;border:0;border-radius:8px;padding:10px 18px;background:var(--accent,#1F57D1);color:var(--accent-ink,#fff);cursor:pointer;min-height:44px}
#pteAuth .btn-p:disabled{opacity:.55;cursor:default}
#pteAuth .lk{font:inherit;font-size:.9rem;border:0;background:none;padding:6px 0;color:var(--accent,#1F57D1);cursor:pointer;text-decoration:underline;text-underline-offset:2px;min-height:32px}
#pteAuth .rodape{text-align:center;color:var(--muted,#5A6862);font-size:.9rem;margin-top:14px}
#pteAuth .voltar{display:inline-block;margin-top:18px;color:var(--muted,#5A6862);font-size:.85rem}
.pte-sair{font:inherit;border:0;background:transparent;color:var(--muted);cursor:pointer;text-align:left}
.pte-sair:hover{color:var(--ink)}
#pteAuth .cx:has(.pl){width:min(460px,100%)}
#pteAuth .pl{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border:1px solid var(--line,#D8E0DB);border-radius:10px;padding:14px}
#pteAuth .pl.dest{border-color:var(--accent,#1F57D1);box-shadow:inset 0 0 0 1px var(--accent,#1F57D1)}
#pteAuth .pl .pr{font-family:var(--f-mono,monospace);font-weight:700;font-size:1.3rem;margin-top:2px}
#pteAuth .pl .pr small{font-size:.8rem;color:var(--muted,#5A6862);font-weight:500}
#pteAuth .pl .ex{font-size:.82rem;color:var(--muted,#5A6862)}
#pteAuth .pl .btn-p{flex:none}
#pteJanela{position:fixed;inset:0;z-index:90;background:rgba(8,12,10,.5);display:flex;align-items:center;justify-content:center;padding:16px}
#pteJanela .jan{width:min(420px,100%);background:var(--surface,#fff);color:var(--ink,#16201B);border:1px solid var(--line,#D8E0DB);border-radius:14px;padding:20px;display:grid;gap:8px}
#pteJanela h2{font-family:var(--f-display,system-ui);font-size:1.15rem;margin:0 0 4px}
#pteJanela p{margin:0}
#pteJanela .sub{color:var(--muted,#5A6862);font-size:.88rem}
#pteJanela .ok{min-height:1.2em;font-size:.88rem;color:var(--bad-ink,#962620)}
#pteJanela .acoes{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
#pteJanela .btn-p{font:inherit;font-weight:700;border:0;border-radius:8px;padding:10px 18px;background:var(--accent,#1F57D1);color:var(--accent-ink,#fff);cursor:pointer;min-height:44px}
#pteJanela .lk{font:inherit;font-size:.9rem;border:0;background:none;padding:6px 0;color:var(--accent,#1F57D1);cursor:pointer;text-decoration:underline;text-underline-offset:2px;min-height:32px}
#pteJanela .lk.perigo{color:var(--bad-ink,#962620)}`;
    document.head.appendChild(st);
  }
  function telaAuth() {
    estilo();
    let el = $("#pteAuth");
    if (!el) { el = document.createElement("div"); el.id = "pteAuth"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Entrar na Mesa de Estudos"); document.body.appendChild(el); }
    const t = AUTH.tela, emailAntes = $("#pteEmail")?.value || "";
    const titulo = { entrar: "Entrar", criar: "Criar conta", esqueci: "Recuperar senha", "nova-senha": "Definir nova senha" }[t];
    const botao = { entrar: "Entrar", criar: "Criar conta", esqueci: "Enviar link", "nova-senha": "Salvar senha" }[t];
    el.innerHTML = `<div class="cx">
      <div class="marca"><i></i>Mesa de Estudos</div>
      <p class="sub">Seu ciclo, suas horas e suas revisões, salvos na sua conta.</p>
      <form id="pteForm" novalidate>
        <h2>${titulo}</h2>
        ${t !== "nova-senha" ? `<label>E-mail<input type="email" id="pteEmail" autocomplete="email" inputmode="email" required value="${esc(emailAntes)}"></label>` : ""}
        ${t !== "esqueci" ? `<label>${t === "nova-senha" ? "Nova senha" : "Senha"}<input type="password" id="pteSenha" autocomplete="${t === "entrar" ? "current-password" : "new-password"}" minlength="8" required></label>` : ""}
        <p class="ok ${AUTH.erro ? "erro" : "bom"}" role="alert">${esc(AUTH.erro || AUTH.msg)}</p>
        <div class="acoes">
          <span>${t === "entrar" ? `<button type="button" class="lk" data-pte="esqueci">Esqueci minha senha</button>` : t !== "nova-senha" ? `<button type="button" class="lk" data-pte="entrar">Voltar para entrar</button>` : ""}</span>
          <button class="btn-p" type="submit" ${AUTH.ocupado ? "disabled" : ""}>${AUTH.ocupado ? "Aguarde…" : botao}</button>
        </div>
      </form>
      ${t === "entrar" ? `<p class="rodape">Primeira vez aqui? <button type="button" class="lk" data-pte="criar">Criar conta</button></p>` : ""}
      <p class="rodape"><a class="voltar" href="../">← Voltar para o Rumo à Posse</a></p>
    </div>`;
    el.querySelectorAll("[data-pte]").forEach(b => b.onclick = () => { AUTH.tela = b.dataset.pte; AUTH.erro = ""; AUTH.msg = ""; telaAuth(); });
    $("#pteForm").onsubmit = enviarAuth;
    ($("#pteEmail") && !emailAntes ? $("#pteEmail") : $("#pteSenha"))?.focus();
  }
  async function enviarAuth(e) {
    e.preventDefault(); if (AUTH.ocupado) return;
    const email = ($("#pteEmail")?.value || "").trim(), senha = $("#pteSenha")?.value || "";
    const volta = location.origin + location.pathname;
    const falha = m => { AUTH.erro = m; AUTH.msg = ""; telaAuth(); };
    if (AUTH.tela !== "nova-senha" && !/^\S+@\S+\.\S+$/.test(email)) return falha("Informe um e-mail válido.");
    if (AUTH.tela !== "esqueci" && !senha) return falha("Informe a senha.");
    if ((AUTH.tela === "criar" || AUTH.tela === "nova-senha") && (senha.length < 8 || !/[A-Za-zÀ-ú]/.test(senha) || !/\d/.test(senha)))
      return falha("Use uma senha com pelo menos 8 caracteres, com letras e números.");
    AUTH.ocupado = true; AUTH.erro = ""; AUTH.msg = ""; telaAuth();
    try {
      if (AUTH.tela === "entrar") { const { error } = await sb.auth.signInWithPassword({ email, password: senha }); if (error) throw error; }
      else if (AUTH.tela === "criar") {
        const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: volta } }); if (error) throw error;
        if (!data.session) { AUTH.tela = "entrar"; AUTH.msg = "Conta criada. Enviamos um link para o seu e-mail: abra o link para confirmar e depois entre aqui."; }
      } else if (AUTH.tela === "esqueci") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: volta }); if (error) throw error;
        AUTH.tela = "entrar"; AUTH.msg = "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha.";
      } else {
        const { error } = await sb.auth.updateUser({ password: senha }); if (error) throw error;
        recuperando = false; history.replaceState(null, "", location.pathname);
        const { data } = await sb.auth.getSession(); AUTH.ocupado = false; entrou(data?.session); return;
      }
    } catch (err) { AUTH.erro = MSG(err); }
    AUTH.ocupado = false; telaAuth();
  }
  function entrou(s) {
    if (!s?.user || recuperando) return;
    if (sessao && sessao.user.id !== s.user.id) { location.reload(); return; } // outra conta: recomeça do zero
    const primeira = !sessao; sessao = s;
    if (!primeira) return;
    window.userId = s.user.id; window.sb = sb;
    verificarAcesso();
  }
  function abrirApp() {
    if (aberto) return; aberto = true;
    $("#pteAuth")?.remove();
    liberar();
    botoesConta();
  }
  let aberto = false;

  /* ---------- assinatura: quem pode usar (a regra fica no banco: mesa_situacao) ---------- */
  let SIT = null;
  const fmtData = s => s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const fmtPreco = v => "R$ " + Number(String(v || "0").replace(",", ".")).toFixed(2).replace(".", ",");
  const diasAte = s => Math.max(0, Math.ceil((new Date(s).getTime() - Date.now()) / 864e5));
  const ERROS_PAG = { nao_configurado: "A cobrança ainda não foi configurada. Tente mais tarde.", ja_assinante: "Sua assinatura já está ativa. Recarregue a página.",
    sem_login: "Sua sessão expirou. Entre de novo.", mp_token: "A cobrança está com problema de configuração. Avise o suporte.", preco: "Os preços não estão configurados. Avise o suporte.",
    sem_assinatura: "Não há assinatura ativa para cancelar.", rede: "Sem conexão. Confira a internet e tente de novo.", funcao_ausente: "A cobrança ainda não foi publicada no servidor." };
  async function pagamentos(corpo) {
    let res; try { res = await sb.functions.invoke("mesa-pagamentos", { body: corpo }); } catch { throw { code: "rede" }; }
    if (res.error) { let codigo = ""; try { codigo = (await res.error.context?.json?.())?.codigo || ""; } catch {}
      const st = res.error.context?.status; throw { code: codigo || (st === 404 ? "funcao_ausente" : /fetch|network|Failed to send/i.test(String(res.error.message)) ? "rede" : "falha") }; }
    return res.data;
  }
  async function lerSituacao() {
    const { data, error } = await sb.rpc("mesa_situacao");
    if (error) {
      // SQL das assinaturas ainda não rodado: sem regra no banco, o app abre normalmente
      if (error.code === "PGRST202" || /Could not find the function/i.test(error.message || "")) { console.warn("mesa_situacao ausente: rode supabase-assinaturas.sql"); return { acesso: true, motivo: "nao_configurado" }; }
      throw error;
    }
    return data || { acesso: false, motivo: "sem_acesso" };
  }
  async function verificarAcesso() {
    const qs = new URLSearchParams(location.search), voltouDoPagamento = qs.get("assinatura") === "retorno", planoPedido = qs.get("plano");
    if (voltouDoPagamento || planoPedido) { qs.delete("assinatura"); qs.delete("plano"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "") + location.hash); }
    try {
      if (voltouDoPagamento) {
        telaAviso("Confirmando seu pagamento…", "Isso leva alguns segundos.");
        for (let i = 0; i < 6; i++) {
          try { await pagamentos({ acao: "conferir" }); } catch {}
          SIT = await lerSituacao(); if (SIT.motivo === "assinante" || SIT.motivo === "admin") break;
          await new Promise(r => setTimeout(r, 3000));
        }
      } else SIT = await lerSituacao();
    } catch {
      telaAviso("Não foi possível conferir sua conta", "Confira a internet e tente de novo.", true); return;
    }
    if (SIT.acesso && !(planoPedido && SIT.motivo === "teste")) { abrirApp(); if (voltouDoPagamento && SIT.motivo === "assinante") avisoRapido("Assinatura confirmada. Bons estudos!"); return; }
    telaPlanos(planoPedido === "anual" ? "anual" : planoPedido === "mensal" ? "mensal" : "");
  }
  function telaAviso(titulo, texto, comBotao) {
    estilo(); let el = $("#pteAuth"); if (!el) { el = document.createElement("div"); el.id = "pteAuth"; document.body.appendChild(el); }
    el.innerHTML = `<div class="cx"><div class="marca"><i></i>Mesa de Estudos</div><form><h2>${esc(titulo)}</h2><p class="sub" style="margin:0">${esc(texto)}</p>
      ${comBotao ? `<div class="acoes"><button type="button" class="lk" data-sair>Sair</button><button type="button" class="btn-p" data-de-novo>Tentar de novo</button></div>` : ""}</form></div>`;
    el.querySelector("[data-de-novo]")?.addEventListener("click", verificarAcesso);
    el.querySelector("[data-sair]")?.addEventListener("click", sair);
  }
  function telaPlanos(destaque, erro, ocupado) {
    estilo(); let el = $("#pteAuth"); if (!el) { el = document.createElement("div"); el.id = "pteAuth"; el.setAttribute("role", "dialog"); document.body.appendChild(el); }
    const s = SIT || {}, emTeste = s.motivo === "teste", pendente = s.status === "pending";
    const titulo = emTeste ? "Assine a Mesa de Estudos" : s.status === "cancelled" ? "Sua assinatura terminou" : s.teste_ate ? "Seu teste grátis terminou" : "Assine para continuar";
    const sub = emTeste ? `Você está no teste grátis até ${fmtData(s.teste_ate)}. Assinando agora, nada se perde.` : "Seus estudos continuam guardados. Assine para voltar a registrar.";
    const card = (id, nome, preco, por, extra) => `<div class="pl ${destaque === id ? "dest" : ""}"><div><b>${nome}</b><div class="pr">${fmtPreco(preco)}<small>${por}</small></div>${extra ? `<div class="ex">${extra}</div>` : ""}</div>
      <button type="button" class="btn-p" data-assinar="${id}" ${ocupado ? "disabled" : ""}>${ocupado === id ? "Abrindo o Mercado Pago…" : "Assinar " + nome.toLowerCase()}</button></div>`;
    el.innerHTML = `<div class="cx">
      <div class="marca"><i></i>Mesa de Estudos</div>
      <form onsubmit="return false"><h2>${titulo}</h2><p class="sub" style="margin:0">${sub}</p>
        ${card("mensal", "Mensal", s.preco_mensal || "19.90", "/mês", "Cancele quando quiser")}
        ${card("anual", "Anual", s.preco_anual || "179.90", "/ano", `Equivale a ${fmtPreco(Number(String(s.preco_anual || "179.90").replace(",", ".")) / 12)} por mês`)}
        <p class="ok erro" role="alert">${esc(erro || "")}</p>
        ${pendente ? `<p class="sub" style="margin:0">Já pagou? A confirmação do Mercado Pago pode levar alguns minutos. <button type="button" class="lk" data-conferir>Conferir pagamento</button></p>` : ""}
        <p class="sub" style="margin:0;font-size:.85rem">Pagamento seguro pelo Mercado Pago. A renovação é automática e você cancela pelo próprio app. 7 dias de garantia: se não gostar, devolvemos o valor.</p>
        <div class="acoes">${emTeste ? `<button type="button" class="lk" data-continuar>Continuar no teste grátis</button>` : `<button type="button" class="lk" data-baixar>Baixar meus dados</button>`}<button type="button" class="lk" data-sair>Sair</button></div>
      </form>
      <p class="rodape"><a class="voltar" href="../">← Voltar para o Rumo à Posse</a></p></div>`;
    el.querySelectorAll("[data-assinar]").forEach(b => b.onclick = async () => {
      const plano = b.dataset.assinar; telaPlanos(plano, "", plano);
      try { const r = await pagamentos({ acao: "assinar", plano }); if (!r?.url) throw { code: "falha" }; location.href = r.url; }
      catch (e) { telaPlanos(plano, ERROS_PAG[e?.code] || "Não foi possível abrir o pagamento agora. Tente de novo."); }
    });
    el.querySelector("[data-conferir]")?.addEventListener("click", async () => {
      telaAviso("Conferindo…", "Um momento.");
      try { await pagamentos({ acao: "conferir" }); } catch {}
      try { SIT = await lerSituacao(); } catch {}
      if (SIT?.acesso && SIT.motivo !== "teste") abrirApp(); else telaPlanos(destaque, "O pagamento ainda não foi confirmado. Tente de novo em alguns minutos.");
    });
    el.querySelector("[data-continuar]")?.addEventListener("click", abrirApp);
    el.querySelector("[data-baixar]")?.addEventListener("click", baixarDados);
    el.querySelector("[data-sair]")?.addEventListener("click", sair);
  }
  /* Quem está sem acesso ainda pode levar os próprios dados (o banco libera a leitura). */
  async function baixarDados() {
    const { data, error } = await sb.from("documentos").select("chave,dados,atualizado_em");
    if (error) { avisoRapido("Não foi possível baixar agora."); return; }
    await downloads.save({ filename: `mesa-de-estudos-dados-${new Date().toISOString().slice(0, 10)}.json`, data: JSON.stringify(data, null, 2) });
  }
  function avisoRapido(msg) {
    const t = document.getElementById("toast");
    if (t) { t.textContent = msg; t.hidden = false; setTimeout(() => { t.hidden = true; }, 4000); }
  }
  async function sair() { try { await sb.auth.signOut(); } catch {} location.reload(); }

  /* Janela "Assinatura", aberta pela barra lateral. */
  function janelaAssinatura(erro, ocupado) {
    estilo(); let el = $("#pteJanela");
    if (!el) { el = document.createElement("div"); el.id = "pteJanela"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Assinatura"); document.body.appendChild(el); }
    const s = SIT || {};
    const linhas = s.motivo === "admin" ? ["Conta de administrador: acesso liberado sem assinatura."]
      : s.motivo === "nao_configurado" ? ["A cobrança ainda não foi ativada neste site."]
      : s.status === "authorized" ? [`Plano ${s.plano}, ativo.`, `Próxima renovação por volta de ${fmtData(s.valido_ate)}.`]
      : s.motivo === "assinante" ? [`Assinatura ${s.status === "cancelled" ? "cancelada" : "pausada"}.`, `Seu acesso vai até ${fmtData(s.valido_ate)}.`]
      : s.motivo === "teste" ? [`Teste grátis até ${fmtData(s.teste_ate)} (${diasAte(s.teste_ate)} dia(s)).`] : ["Sem assinatura ativa."];
    el.innerHTML = `<div class="jan"><h2>Assinatura</h2>${linhas.map(l => `<p>${esc(l)}</p>`).join("")}
      ${sessao?.user?.email ? `<p class="sub">Conta: ${esc(sessao.user.email)}</p>` : ""}
      <p class="ok erro" role="alert">${esc(erro || "")}</p>
      <div class="acoes">
        ${s.status === "authorized" ? `<button type="button" class="lk perigo" data-cancelar ${ocupado ? "disabled" : ""}>Cancelar renovação</button>` : ["teste", "assinante"].includes(s.motivo) ? `<button type="button" class="btn-p" data-planos>Ver planos</button>` : "<span></span>"}
        <button type="button" class="lk" data-fechar>Fechar</button>
      </div></div>`;
    el.onclick = e => { if (e.target === el) el.remove(); };
    el.querySelector("[data-fechar]").onclick = () => el.remove();
    el.querySelector("[data-planos]")?.addEventListener("click", () => { el.remove(); telaPlanos(""); });
    const c = el.querySelector("[data-cancelar]");
    if (c) c.onclick = async () => {
      if (!c.dataset.armado) { c.dataset.armado = 1; c.textContent = "Toque de novo para cancelar"; setTimeout(() => { if (c.isConnected) { delete c.dataset.armado; c.textContent = "Cancelar renovação"; } }, 4000); return; }
      janelaAssinatura("", true);
      try { await pagamentos({ acao: "cancelar" }); SIT = await lerSituacao(); janelaAssinatura(); avisoRapido("Renovação cancelada. O acesso continua até o fim do período pago."); }
      catch (e) { janelaAssinatura(ERROS_PAG[e?.code] || "Não foi possível cancelar agora. Tente de novo."); }
    };
  }

  /* ---------- botões "Assinatura" e "Sair" na barra lateral ---------- */
  function botoesConta() {
    if (SIT?.motivo === "teste" && SIT.teste_ate) setTimeout(() => avisoRapido(`Teste grátis: ${diasAte(SIT.teste_ate)} dia(s) restante(s). Assine em “Assinatura”, na barra lateral.`), 1200);
    const por = () => {
      const fim = document.querySelector("#nav .side-fim");
      if (!fim || fim.querySelector(".pte-sair")) return;
      const ass = document.createElement("button");
      ass.type = "button"; ass.className = "side-a pte-sair pte-ass";
      ass.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg><span class="side-t">Assinatura</span>`;
      ass.onclick = async () => { try { SIT = await lerSituacao(); } catch {} janelaAssinatura(); };
      fim.appendChild(ass);
      const b = document.createElement("button");
      b.type = "button"; b.className = "side-a pte-sair"; b.title = sessao?.user?.email ? "Conectado como " + sessao.user.email : "Sair da conta";
      b.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/></svg><span class="side-t">Sair</span>`;
      b.onclick = async () => {
        if (!b.dataset.armado) { b.dataset.armado = 1; b.querySelector(".side-t").textContent = "Toque de novo para sair"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armado; b.querySelector(".side-t").textContent = "Sair"; } }, 4000); return; }
        try { await sb.auth.signOut(); } catch {}
        location.reload();
      };
      fim.appendChild(b);
    };
    por();
    new MutationObserver(por).observe($("#nav") || document.body, { childList: true, subtree: true });
  }

  /* ---------- "db": coleção de documentos sobre a tabela public.documentos ----------
     Cada linha guarda { chave, dados }. O número de versão do app (_v) vai dentro de "dados". */
  function erroDe(error) {
    const m = String(error?.message || error || ""), st = Number(error?.status) || 0;
    const code = !navigator.onLine || /fetch|network|Failed|timeout/i.test(m) || st >= 500 ? "unavailable"
      : /payload|too large|23514|check constraint/i.test(m + " " + (error?.code || "")) ? "invalid_argument"
      : /jwt|token|401|permission|42501|row-level/i.test(m + " " + (error?.code || "")) ? "permission_denied" : "unknown";
    return Object.assign(new Error(m || code), { code });
  }
  function colecao() {
    const uid = () => window.userId;
    const docs = new Map(); // chave → objeto entregue ao app (mesma referência enquanto não muda)
    const ouvintes = new Set();
    const fotografia = () => ({ metadata: { fromCache: false }, docs: [...docs].map(([id, v]) => ({ id, exists: true, data: () => v })) });
    const avisar = () => { const s = fotografia(); ouvintes.forEach(o => { try { o.ok(s); } catch (e) { console.error(e); } }); };
    const guardar = (chave, dados) => {
      const atual = docs.get(chave), novo = dados && typeof dados === "object" ? dados : {};
      if (atual && JSON.stringify(atual) === JSON.stringify(novo)) return false;
      docs.set(chave, novo); return true;
    };
    async function carregarTudo() {
      const { data, error } = await sb.from("documentos").select("chave,dados").eq("user_id", uid());
      if (error) throw erroDe(error);
      const vistos = new Set(); let mudou = false;
      for (const r of data || []) { vistos.add(r.chave); if (guardar(r.chave, r.dados)) mudou = true; }
      for (const k of [...docs.keys()]) if (!vistos.has(k)) { docs.delete(k); mudou = true; }
      return mudou;
    }
    let canal = null;
    function ligarTempoReal() {
      if (canal) return;
      canal = sb.channel("documentos-" + uid())
        .on("postgres_changes", { event: "*", schema: "public", table: "documentos", filter: `user_id=eq.${uid()}` }, p => {
          if (p.eventType === "DELETE") { const k = p.old?.chave; if (k && docs.delete(k)) avisar(); return; }
          const r = p.new; if (r?.chave && guardar(r.chave, r.dados)) avisar();
        })
        .subscribe(st => {
          if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { const c = canal; canal = null; try { sb.removeChannel(c); } catch {} ouvintes.forEach(o => o.erro?.(Object.assign(new Error("tempo real indisponível"), { code: "unavailable" }))); }
        });
    }
    // Ao voltar para a aba ou reconectar, confere o servidor (eventos perdidos enquanto estava fora).
    const conferir = () => { if (!ouvintes.size) return; carregarTudo().then(m => m && avisar()).catch(() => {}); };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") conferir(); });
    window.addEventListener("online", conferir);

    const doc = chave => ({
      async get() {
        const { data, error } = await sb.from("documentos").select("dados").eq("user_id", uid()).eq("chave", chave).maybeSingle();
        if (error) throw erroDe(error);
        if (!data) return { id: chave, exists: false, data: () => undefined };
        return { id: chave, exists: true, data: () => data.dados };
      },
      async set(corpo) {
        const { error } = await sb.from("documentos").upsert({ user_id: uid(), chave, dados: corpo }, { onConflict: "user_id,chave" });
        if (error) throw erroDe(error);
        if (guardar(chave, JSON.parse(JSON.stringify(corpo)))) avisar();
      },
      async delete() {
        const { error } = await sb.from("documentos").delete().eq("user_id", uid()).eq("chave", chave);
        if (error) throw erroDe(error);
        if (docs.delete(chave)) avisar();
      }
    });
    const consulta = {
      limit() { return consulta; },
      onSnapshot(ok, erro) {
        const o = { ok, erro }; ouvintes.add(o);
        carregarTudo().then(() => { if (ouvintes.has(o)) { ok(fotografia()); ligarTempoReal(); } }).catch(e => erro?.(e.code ? e : erroDe(e)));
        return () => ouvintes.delete(o);
      }
    };
    return { doc, ...consulta };
  }
  let COL = null;
  const db = { collection() { return COL ||= colecao(); } };

  /* ---------- "user" e "downloads" ---------- */
  const user = { async id() { return sessao.user.id; }, async email() { return sessao.user.email; } };
  const downloads = {
    async save({ filename, data, mimeType }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || (typeof data === "string" ? "application/json" : "application/octet-stream") });
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename || "arquivo"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  };

  /* O app chama window.claude.use(...) ao abrir; a resposta só sai depois do login. */
  window.claude = {
    use(nome) {
      if (nome === "db") return pronto.then(() => db);
      if (nome === "user") return pronto.then(() => user);
      if (nome === "downloads") return pronto.then(() => downloads);
      return Promise.resolve(null); // "sample" e "assets": no site a IA e os arquivos usam o Supabase direto
    }
  };

  /* ---------- início ---------- */
  function iniciar() {
    if (!window.supabase || !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
      estilo(); const el = document.createElement("div"); el.id = "pteAuth";
      el.innerHTML = `<div class="cx"><div class="marca"><i></i>Mesa de Estudos</div><form><h2>Não foi possível abrir</h2><p class="sub">${window.supabase ? "Falta a configuração do Supabase (config.js)." : "A conexão com o servidor falhou. Confira a internet e recarregue a página."}</p></form></div>`;
      document.body.appendChild(el); return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((evento, s) => {
      if (evento === "PASSWORD_RECOVERY") { recuperando = true; AUTH.tela = "nova-senha"; AUTH.erro = ""; AUTH.msg = ""; telaAuth(); return; }
      if (evento === "SIGNED_OUT") { if (sessao) location.reload(); return; }
      setTimeout(() => entrou(s), 0);
    });
    sb.auth.getSession().then(({ data }) => { if (data?.session) entrou(data.session); else if (!recuperando) telaAuth(); });
  }
  if (document.body) iniciar(); else document.addEventListener("DOMContentLoaded", iniciar, { once: true });
})();
