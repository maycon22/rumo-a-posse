/* Rumo à Posse · interações visuais
   - luz que acompanha o mouse nos cartões e cartão inteiro clicável
   - elementos entram suavemente ao rolar a página
   - sombra no topo, barra de leitura e botão de voltar ao topo
   - prévia da Mesa de Estudos "viva" (cronômetro e gráficos animados)
   Quem ativou "reduzir movimento" no aparelho vê tudo sem animação. */
(function () {
  const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const temHover = matchMedia("(hover: hover)").matches;

  /* ---------- Luz que segue o mouse ---------- */
  if (temHover && !reduzir) {
    let alvo = null, x = 0, y = 0, agendado = false;
    document.addEventListener("pointermove", (e) => {
      alvo = e.target.closest && e.target.closest(".card");
      if (!alvo) return;
      x = e.clientX; y = e.clientY;
      if (agendado) return;
      agendado = true;
      requestAnimationFrame(() => {
        agendado = false;
        if (!alvo) return;
        const r = alvo.getBoundingClientRect();
        alvo.style.setProperty("--mx", `${x - r.left}px`);
        alvo.style.setProperty("--my", `${y - r.top}px`);
      });
    }, { passive: true });
  }

  /* ---------- Cartão inteiro clicável (sem atrapalhar seleção de texto) ---------- */
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".card.clicavel");
    if (!card || e.target.closest("a, button")) return;
    if (String(getSelection && getSelection()).length) return;   // a pessoa estava selecionando texto
    const link = card.querySelector("a.stretch, a.link-detalhes");
    if (link) link.click();
  });

  /* ---------- Entrada suave ao rolar ---------- */
  const SELETOR = ".card, .section-head, .edital, .ficha, .banca-box, .det-secao, .det-sumario, details, .news, .table-wrap, .sales-hero";
  let io = null;
  if (!reduzir && "IntersectionObserver" in window) {
    io = new IntersectionObserver((itens) => {
      for (const it of itens) {
        if (!it.isIntersecting) continue;
        it.target.classList.add("in");
        io.unobserve(it.target);
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0 });   // 0: elementos altos (tabelas longas) também entram
  }
  function preparar(raiz) {
    if (!io) return;
    raiz.querySelectorAll(SELETOR).forEach((el) => {
      if (el.dataset.rev) return;
      el.dataset.rev = "1";
      // já visível na tela ao carregar: entra junto, com pequeno atraso em cascata
      const irmaos = el.parentElement ? [...el.parentElement.children].filter((c) => c.matches(SELETOR)) : [];
      const i = Math.max(0, irmaos.indexOf(el));
      el.style.transitionDelay = `${Math.min(i, 6) * 70}ms`;
      el.classList.add("reveal");
      io.observe(el);
      // tira o atraso depois da entrada, para o hover responder na hora
      el.addEventListener("transitionend", () => { el.style.transitionDelay = ""; }, { once: true });
    });
  }
  const main = document.getElementById("conteudo");
  if (main && io) {
    preparar(main);
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) {
        if (n.matches && n.matches(SELETOR)) preparar(n.parentElement || main);
        else preparar(n);
      }
    }).observe(main, { childList: true, subtree: true });
  }

  /* ---------- Topo com sombra, barra de leitura e voltar ao topo ---------- */
  const topo = document.querySelector("header.top");
  const barra = document.createElement("div");
  barra.className = "progresso-leitura"; barra.setAttribute("aria-hidden", "true");
  const btnTopo = document.createElement("button");
  btnTopo.type = "button"; btnTopo.className = "topo-btn"; btnTopo.setAttribute("aria-label", "Voltar ao topo da página");
  btnTopo.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  btnTopo.addEventListener("click", () => scrollTo({ top: 0, behavior: reduzir ? "auto" : "smooth" }));
  document.body.append(barra, btnTopo);

  let pend = false;
  function aoRolar() {
    pend = false;
    const y = scrollY;
    if (topo) topo.classList.toggle("rolou", y > 8);
    btnTopo.classList.toggle("on", y > 700);
    const leitura = document.querySelector("#v-artigo.active #article-body, #v-concurso.active #concurso-body");
    if (leitura) {
      const r = leitura.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      barra.style.setProperty("--p", p.toFixed(4));
      barra.classList.add("on");
    } else barra.classList.remove("on");
  }
  addEventListener("scroll", () => { if (!pend) { pend = true; requestAnimationFrame(aoRolar); } }, { passive: true });
  addEventListener("popstate", () => setTimeout(aoRolar, 50));
  document.addEventListener("click", () => setTimeout(aoRolar, 80));
  aoRolar();

  /* ---------- Prévia da Mesa de Estudos ---------- */
  const mock = document.querySelector(".app-mock");
  if (mock) {
    const timer = mock.querySelector(".timer");
    let seg = 47 * 60 + 15, intervalo = null;
    const fmt = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
    const ligar = () => { if (!intervalo && !reduzir) intervalo = setInterval(() => { seg++; timer.textContent = fmt(seg); }, 1000); };
    const desligar = () => { clearInterval(intervalo); intervalo = null; };
    if (!reduzir && "IntersectionObserver" in window) {
      mock.classList.add("parado");
      new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { requestAnimationFrame(() => mock.classList.remove("parado")); ligar(); }
        else { desligar(); }
      }, { threshold: 0.3 }).observe(mock);
    }
    // passar o mouse por uma disciplina destaca a barra dela
    mock.querySelectorAll(".row").forEach((r) => {
      r.style.transition = "transform .25s, box-shadow .25s";
      r.addEventListener("pointerenter", () => { r.style.transform = "translateX(4px)"; r.style.boxShadow = "0 6px 16px -10px rgba(0,0,0,.4)"; });
      r.addEventListener("pointerleave", () => { r.style.transform = ""; r.style.boxShadow = ""; });
    });
  }
})();
