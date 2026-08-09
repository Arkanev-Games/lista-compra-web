/**
 * Lista de la compra — lógica de la web.
 *
 * Esta página no tiene backend propio: en cada carga pide "./lista.json"
 * (con cache "no-store" para no quedarse con una versión vieja cacheada
 * por el navegador del móvil) y pinta lo que encuentre. Ese archivo lo
 * sube la app de escritorio con un `git push` cada vez que generas la
 * lista — ver core/publisher.py en el proyecto de escritorio.
 *
 * Todo va en un único IIFE para no volcar nombres al scope global; no
 * hay build step ni módulos, así que esto se sirve tal cual.
 */
(function () {
  "use strict";

  /* Color de acento por categoría (el punto junto al nombre en el
     acordeón). Las claves son las mismas que CategoriaIngrediente en
     core/models.py — si allí se añade una categoría nueva, aquí caería
     en el gris de "otros" hasta que se le asigne un color. */
  var CAT_COLORS = {
    verduras: "#4b8b5f",
    frutas: "#e0663f",
    carne: "#b5533f",
    pescado: "#3c7ea6",
    lacteos_huevos: "#e0b94a",
    pan_cereales: "#ad8a55",
    legumbres_conservas: "#7d7440",
    congelados: "#4fa3ab",
    aceites_condimentos: "#cf8b2e",
    otros: "#8a8f83"
  };

  /* Qué ingredientes están marcados, y bajo qué clave de localStorage
     se guardan. storageKey se recalcula en cada carga a partir de
     "generated_at": así, en cuanto generas una lista nueva desde el
     escritorio, todas las casillas empiezan destapadas otra vez en vez
     de arrastrar lo marcado la semana anterior. */
  var savedChecks = {};
  var storageKey = "compra_sin-fecha";

  function loadSaved(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
  }

  function persistSaved() {
    try { localStorage.setItem(storageKey, JSON.stringify(savedChecks)); } catch (e) {}
  }

  // ============================================================
  // Vista: Compra
  // ============================================================

  function totalItemCount(list) {
    var n = 0;
    list.forEach(function (b) { n += b.items.length; });
    return n;
  }

  /* Cuántos ingredientes de una categoría concreta están marcados.
     El id de cada casilla es "categoria:nombre", así que basta con
     mirar savedChecks con esa clave por cada item del bloque. */
  function checkedCountFor(block) {
    var n = 0;
    block.items.forEach(function (item) {
      if (savedChecks[block.cat + ":" + item.name]) n++;
    });
    return n;
  }

  function updateOverallProgress(list) {
    var total = totalItemCount(list);
    var checked = 0;
    list.forEach(function (block) { checked += checkedCountFor(block); });
    document.getElementById("progress-text").textContent = checked + " / " + total + " marcados";
    document.getElementById("progress-fill").style.width = (total ? (checked / total * 100) : 0) + "%";
  }

  /* Construye el acordeón de categorías a partir de payload.list.
     Cada categoría se crea colapsada (aria-expanded="false", sin la
     clase "open" en el panel) y solo se despliega si el usuario toca
     su cabecera — así la lista entera no ocupa toda la pantalla de
     golpe. */
  function renderAccordion(list) {
    var container = document.getElementById("accordion");
    container.innerHTML = "";

    list.forEach(function (block) {
      var card = document.createElement("div");
      card.className = "cat-card";

      var header = document.createElement("button");
      header.type = "button";
      header.className = "cat-header";
      header.setAttribute("aria-expanded", "false");

      var dot = document.createElement("span");
      dot.className = "cat-dot";
      dot.style.background = CAT_COLORS[block.cat] || CAT_COLORS.otros;

      var name = document.createElement("span");
      name.className = "cat-name";
      name.textContent = block.cat_label;

      var count = document.createElement("span");
      count.className = "cat-count mono";

      var chevron = document.createElement("span");
      chevron.className = "chevron";

      header.appendChild(dot);
      header.appendChild(name);
      header.appendChild(count);
      header.appendChild(chevron);

      // Panel colapsable: ver el truco de grid-template-rows en style.css.
      var panel = document.createElement("div");
      panel.className = "cat-panel";
      var panelInner = document.createElement("div");
      panelInner.className = "cat-panel-inner";
      var items = document.createElement("div");
      items.className = "cat-items";
      panelInner.appendChild(items);
      panel.appendChild(panelInner);

      function refreshCount() {
        count.textContent = checkedCountFor(block) + "/" + block.items.length;
      }
      refreshCount();

      block.items.forEach(function (item) {
        var id = block.cat + ":" + item.name;
        var row = document.createElement("label");
        row.className = "item-row";

        var input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!savedChecks[id];
        input.addEventListener("change", function () {
          savedChecks[id] = input.checked;
          persistSaved();
          refreshCount();
          updateOverallProgress(list);
        });

        var box = document.createElement("span");
        box.className = "check-box";
        box.setAttribute("aria-hidden", "true");

        var text = document.createElement("span");
        text.className = "item-text";
        // item.recipes: qué recetas de la semana necesitan este
        // ingrediente (útil si dos platos piden lo mismo).
        text.innerHTML = '<div class="item-name">' + item.name + '</div><div class="item-who">' + item.recipes.join(", ") + '</div>';

        row.appendChild(input);
        row.appendChild(box);
        row.appendChild(text);
        items.appendChild(row);
      });

      header.addEventListener("click", function () {
        var open = panel.classList.toggle("open");
        header.setAttribute("aria-expanded", open ? "true" : "false");
      });

      card.appendChild(header);
      card.appendChild(panel);
      container.appendChild(card);
    });

    updateOverallProgress(list);
  }

  // ============================================================
  // Vista: Menú
  // ============================================================

  /* payload.menu llega como una lista plana de {day, slot, recipe};
     aquí se agrupa por día preservando el orden en que aparecen (que
     ya viene ordenado de lunes a domingo desde el escritorio) para
     pintar una tarjeta por día con sus franjas dentro. */
  function renderMenu(menu) {
    var container = document.getElementById("menu-list");
    container.innerHTML = "";

    var days = [];
    menu.forEach(function (m) {
      var d = days.find(function (x) { return x.day === m.day; });
      if (!d) { d = { day: m.day, slots: [] }; days.push(d); }
      d.slots.push(m);
    });

    days.forEach(function (d) {
      var card = document.createElement("div");
      card.className = "day-card";
      var name = document.createElement("div");
      name.className = "day-name";
      name.textContent = d.day;
      card.appendChild(name);
      d.slots.forEach(function (s) {
        var row = document.createElement("div");
        row.className = "day-slot";
        row.innerHTML = '<span class="tag">' + (s.slot === "comida" ? "Comida" : "Cena") + '</span><span>' + s.recipe + '</span>';
        card.appendChild(row);
      });
      container.appendChild(card);
    });
  }

  // ============================================================
  // Selector Compra / Menú
  // ============================================================

  /* Solo hay dos pestañas, así que alternar entre ellas es tan
     simple como mostrar/ocultar sus dos secciones y mover el
     resaltado a la posición 0 o 1 (ver .seg-highlight.pos-1 en
     style.css) — no hace falta ningún framework de tabs. */
  function initSegmented() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll(".seg-btn"));
    var highlight = document.getElementById("seg-highlight");
    var panels = { compra: document.getElementById("view-compra"), menu: document.getElementById("view-menu") };

    buttons.forEach(function (btn, idx) {
      btn.addEventListener("click", function () {
        buttons.forEach(function (b) { b.setAttribute("aria-selected", "false"); });
        btn.setAttribute("aria-selected", "true");
        highlight.classList.toggle("pos-1", idx === 1);
        Object.keys(panels).forEach(function (key) {
          panels[key].hidden = key !== btn.dataset.view;
        });
      });
    });
  }

  // ============================================================
  // Carga de datos y estados generales
  // (cargando / sin lista todavía / error de red / contenido)
  // ============================================================

  function formatFecha(iso) {
    try {
      var d = new Date(iso);
      var texto = d.toLocaleString("es-ES", {
        weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
      });
      return texto.charAt(0).toUpperCase() + texto.slice(1);
    } catch (e) {
      return iso; // si el formato de fecha fallara, mejor mostrar el dato crudo que nada
    }
  }

  /* Los cuatro estados son mutuamente excluyentes: mostrar uno
     implica ocultar los otros tres, así que se listan explícitamente
     en vez de tener cuatro banderas sueltas que podrían desincronizarse. */
  function showState(id) {
    ["state-loading", "state-empty", "state-error", "content"].forEach(function (s) {
      document.getElementById(s).hidden = s !== id;
    });
  }

  function showContent(payload) {
    storageKey = "compra_" + (payload.generated_at || "sin-fecha");
    savedChecks = loadSaved(storageKey);

    document.getElementById("lede").innerHTML =
      "Generada el <strong>" + formatFecha(payload.generated_at) + "</strong>.";

    renderAccordion(payload.list || []);
    renderMenu(payload.menu || []);
    showState("content");
  }

  function load() {
    showState("state-loading");
    fetch("./lista.json", { cache: "no-store" })
      .then(function (res) {
        if (res.status === 404) return null; // aún no se ha publicado ninguna lista
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (!payload || ((!payload.menu || !payload.menu.length) && (!payload.list || !payload.list.length))) {
          showState("state-empty");
          return;
        }
        showContent(payload);
      })
      .catch(function () {
        document.getElementById("state-error").textContent =
          "No se pudo cargar la lista. Comprueba tu conexión e inténtalo de nuevo.";
        showState("state-error");
      });
  }

  initSegmented();
  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
})();
