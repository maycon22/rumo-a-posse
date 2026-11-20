/* Tema dia/noite. Carregado no <head> (sem defer) para não piscar a cor errada ao abrir.
   Sem escolha salva, segue o tema do aparelho. */
(function(){
  var KEY = "rap-tema", root = document.documentElement;
  var escuroSistema = window.matchMedia("(prefers-color-scheme: dark)");
  function salvo(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
  function atual(){ return salvo() || (escuroSistema.matches ? "dark" : "light"); }

  function aplicar(t){
    root.setAttribute("data-theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute("content", t === "dark" ? "#0e1626" : "#faf9f6");
    var b = document.getElementById("tema-btn");
    if(b){
      var noite = t === "dark";
      b.setAttribute("aria-pressed", String(noite));
      b.setAttribute("aria-label", noite ? "Mudar para o tema dia" : "Mudar para o tema noite");
      b.title = noite ? "Tema dia" : "Tema noite";
    }
  }
  aplicar(atual());

  // acompanha a troca de tema do aparelho enquanto a pessoa não escolheu um
  escuroSistema.addEventListener && escuroSistema.addEventListener("change", function(){ if(!salvo()) aplicar(atual()); });

  document.addEventListener("DOMContentLoaded", function(){
    aplicar(atual());
    var b = document.getElementById("tema-btn");
    if(!b) return;
    b.addEventListener("click", function(){
      var novo = atual() === "dark" ? "light" : "dark";
      try{ localStorage.setItem(KEY, novo); }catch(e){}
      root.classList.add("tema-trocando");
      aplicar(novo);
      setTimeout(function(){ root.classList.remove("tema-trocando"); }, 350);
    });
  });
})();
