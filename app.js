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
     acordeón de la compra). Se mantienen dentro de la misma familia de
     azules que el resto de la web (índigo a cian), variando tono y luz
     lo justo para distinguir una categoría de otra sin salirse de la
     paleta. Las claves son las mismas que CategoriaIngrediente en
     core/models.py — si allí se añade una categoría nueva, aquí caería
     en el gris-azulado de "otros" hasta que se le asigne un color. */
  var CAT_COLORS = {
    verduras: "#4f8fff",
    frutas: "#7c6bff",
    carne: "#2f6fdb",
    pescado: "#35b8c9",
    lacteos_huevos: "#8fa8ff",
    pan_cereales: "#4479c9",
    legumbres_conservas: "#2c5aa8",
    congelados: "#4fd0e8",
    aceites_condimentos: "#5f7fcf",
    otros: "#5b6478"
  };

  // ============================================================
  // Marcado persistente (localStorage)
  // ------------------------------------------------------------
  // La compra y el menú necesitan lo mismo: recordar qué ids están
  // marcados, bajo una clave que cambia con "generated_at" — así, en
  // cuanto generas una lista nueva desde el escritorio, todo empieza
  // destapado otra vez en vez de arrastrar lo marcado la semana
  // anterior. Se construye una fábrica en vez de duplicar esta lógica
  // una vez para la compra y otra para el menú.
  // ============================================================

  function crearAlmacenMarcado(prefijo) {
    var datos = {};
    var key = prefijo + "_sin-fecha";
    return {
      cargar: function (generatedAt) {
        key = prefijo + "_" + (generatedAt || "sin-fecha");
        try { datos = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { datos = {}; }
      },
      estaMarcado: function (id) { return !!datos[id]; },
      marcar: function (id, valor) {
        datos[id] = valor;
        try { localStorage.setItem(key, JSON.stringify(datos)); } catch (e) {}
      }
    };
  }

  var comprasMarcadas = crearAlmacenMarcado("compra");
  var menuMarcado = crearAlmacenMarcado("menu");

  /* Actualiza una barra de progreso genérica (se usa tanto para "X/Y
     marcados" en Compra como para "X/Y hechas" en Menú). */
  function actualizarProgreso(textId, fillId, marcados, total, etiqueta) {
    document.getElementById(textId).textContent = marcados + " / " + total + " " + etiqueta;
    document.getElementById(fillId).style.width = (total ? (marcados / total * 100) : 0) + "%";
  }

  /* Fila con casilla reutilizada por la lista de la compra y el menú:
     un <label> con un checkbox real (oculto visualmente, ver
     .item-row input en style.css), la caja pintada a mano y el texto.
     Marcar la casilla tacha el nombre mediante CSS (:checked ~ .item-text). */
  function crearFilaMarcable(id, marcadoInicial, htmlTexto, onCambio) {
    var row = document.createElement("label");
    row.className = "item-row";

    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = marcadoInicial;
    input.addEventListener("change", function () { onCambio(input.checked); });

    var box = document.createElement("span");
    box.className = "check-box";
    box.setAttribute("aria-hidden", "true");

    var text = document.createElement("span");
    text.className = "item-text";
    text.innerHTML = htmlTexto;

    row.appendChild(input);
    row.appendChild(box);
    row.appendChild(text);
    return row;
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
     El id de cada casilla es "categoria:nombre". */
  function checkedCountFor(block) {
    var n = 0;
    block.items.forEach(function (item) {
      if (comprasMarcadas.estaMarcado(block.cat + ":" + item.name)) n++;
    });
    return n;
  }

  function updateOverallProgress(list) {
    var checked = 0;
    list.forEach(function (block) { checked += checkedCountFor(block); });
    actualizarProgreso("progress-text", "progress-fill", checked, totalItemCount(list), "marcados");
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
        // item.recipes: qué recetas de la semana necesitan este
        // ingrediente (útil si dos platos piden lo mismo).
        var texto = '<div class="item-name">' + item.name + '</div><div class="item-who">' + item.recipes.join(", ") + '</div>';
        var row = crearFilaMarcable(id, comprasMarcadas.estaMarcado(id), texto, function (marcado) {
          comprasMarcadas.marcar(id, marcado);
          refreshCount();
          updateOverallProgress(list);
        });
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
  // ------------------------------------------------------------
  // El plan semanal no siempre se cumple al pie de la letra, así que
  // cada comida/cena se puede tachar según se va cocinando: así de un
  // vistazo se ve qué recetas del menú siguen "disponibles" (sin
  // tachar) en vez de tener que recordarlo.
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
        var id = s.day + ":" + s.slot;
        var etiquetaFranja = s.slot === "comida" ? "Comida" : "Cena";
        var texto = '<div class="item-name">' + s.recipe + '</div><div class="item-who">' + etiquetaFranja + '</div>';
        var row = crearFilaMarcable(id, menuMarcado.estaMarcado(id), texto, function (marcado) {
          menuMarcado.marcar(id, marcado);
          updateMenuProgress(menu);
        });
        card.appendChild(row);
      });

      container.appendChild(card);
    });

    updateMenuProgress(menu);
  }

  function updateMenuProgress(menu) {
    var hechas = menu.filter(function (s) { return menuMarcado.estaMarcado(s.day + ":" + s.slot); }).length;
    actualizarProgreso("menu-progress-text", "menu-progress-fill", hechas, menu.length, "hechas");
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

    function seleccionar(btn, idx) {
      buttons.forEach(function (b) { b.setAttribute("aria-selected", "false"); });
      btn.setAttribute("aria-selected", "true");
      highlight.classList.toggle("pos-1", idx === 1);
      Object.keys(panels).forEach(function (key) {
        panels[key].hidden = key !== btn.dataset.view;
      });
    }

    buttons.forEach(function (btn, idx) {
      btn.addEventListener("click", function () { seleccionar(btn, idx); });
    });

    // El resaltado se sitúa según qué botón trae aria-selected="true"
    // en el propio HTML, en vez de asumir que siempre es el primero:
    // así el orden de los botones en el marcado puede cambiar sin que
    // la pastilla se quede desincronizada de la pestaña activa.
    var inicial = buttons.findIndex(function (b) { return b.getAttribute("aria-selected") === "true"; });
    seleccionar(buttons[inicial >= 0 ? inicial : 0], inicial >= 0 ? inicial : 0);
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
    comprasMarcadas.cargar(payload.generated_at);
    menuMarcado.cargar(payload.generated_at);

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
