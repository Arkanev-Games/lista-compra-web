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
  // Sincronización entre dispositivos (opcional)
  // ------------------------------------------------------------
  // Sin nada más, lo marcado vive solo en el localStorage de cada
  // navegador. Si el usuario pega en el panel "Sincronizar" un token
  // personal de GitHub (con permiso de escritura solo sobre este
  // repositorio), cada cambio se sube además a estado.json en el
  // propio repo mediante la API de contenidos de GitHub — y así
  // cualquier otro dispositivo lo ve con un simple fetch (lectura
  // pública, sin token) la próxima vez que abra la página.
  //
  // El token no se sube nunca a ningún sitio propio: solo se guarda
  // en el localStorage de ese dispositivo y se usa para hablar
  // directamente con la API de GitHub desde el propio navegador.
  // ============================================================

  var REPO_OWNER = "Arkanev-Games";
  var REPO_NAME = "lista-compra-web";
  var ESTADO_PATH = "estado.json";
  var TOKEN_KEY = "gh_token";

  var currentGeneratedAt = null;
  var subidaPendiente = null;

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function apiUrl(path) {
    return "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path;
  }

  // btoa() solo entiende Latin-1: se pasa primero por TextEncoder para
  // no romper los acentos del menú/la lista al codificar a base64.
  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function setSyncStatus(estado) {
    var el = document.getElementById("sync-status");
    if (!el) return;
    el.className = "sync-status" + (estado === "ok" ? " ok" : estado === "error" ? " error" : "");
    el.textContent = {
      "sin-token": "Sin sincronizar: pega un token para que lo marcado se vea igual en tus otros dispositivos.",
      "guardado": "Token guardado en este dispositivo.",
      "subiendo": "Sincronizando…",
      "ok": "Sincronizado con GitHub.",
      "error": "No se pudo sincronizar (revisa el token). Se ha guardado solo en este dispositivo."
    }[estado] || "";
  }

  /* Sube el estado combinado (compra + menú) a estado.json. Antes lee
     el archivo actual para conocer su "sha" — la API de GitHub lo
     exige para saber que no se está pisando un cambio de otro
     dispositivo a ciegas — y si justo ha cambiado entre medias
     (409), reintenta una vez con el sha nuevo. */
  function subirEstado(estadoActual, reintento) {
    var token = getToken();
    if (!token) return;

    fetch(apiUrl(ESTADO_PATH), { headers: { Authorization: "Bearer " + token } })
      .then(function (res) {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (actual) {
        var body = {
          message: "Actualiza estado de marcado",
          content: utf8ToBase64(JSON.stringify(estadoActual, null, 2))
        };
        if (actual && actual.sha) body.sha = actual.sha;
        return fetch(apiUrl(ESTADO_PATH), {
          method: "PUT",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      })
      .then(function (res) {
        if (res.status === 409 && !reintento) return subirEstado(estadoActual, true);
        if (!res.ok) throw new Error("HTTP " + res.status);
        setSyncStatus("ok");
      })
      .catch(function () { setSyncStatus("error"); });
  }

  /* Se llama tras cada cambio en cualquiera de los dos almacenes.
     Agrupa varios toques seguidos (por ejemplo, marcar media docena
     de ingredientes de golpe) en una sola subida en vez de una por
     casilla. */
  function programarSubida() {
    if (!getToken() || !currentGeneratedAt) return;
    clearTimeout(subidaPendiente);
    setSyncStatus("subiendo");
    subidaPendiente = setTimeout(function () {
      subirEstado({
        generated_at: currentGeneratedAt,
        compra: comprasMarcadas.exportar(),
        menu: menuMarcado.exportar()
      });
    }, 800);
  }

  /* Al cargar, además de lo que ya haya en este navegador, se intenta
     leer estado.json (lectura pública, sin token) y, si pertenece a
     la misma lista (mismo generated_at), sustituye lo local por lo
     remoto — así un móvil que no ha tocado nada ve lo que se marcó
     desde otro dispositivo. Devuelve si hubo algo que aplicar, para
     que quien la llama sepa si tiene que volver a pintar la pantalla. */
  function cargarEstadoRemoto(generatedAt) {
    return fetch("./estado.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (remoto) {
        if (!remoto || remoto.generated_at !== generatedAt) return false;
        comprasMarcadas.reemplazarTodo(remoto.compra || {});
        menuMarcado.reemplazarTodo(remoto.menu || {});
        return true;
      });
  }

  /* El mismo token vale para varios dispositivos (no hace falta uno
     por persona), así que en vez de tener que copiarlo y pegarlo a
     mano en cada móvil, aquí se arma un enlace que ya lo lleva
     incluido: abrirlo una vez basta para dejar ese dispositivo
     sincronizado. Se actualiza cada vez que cambia el token guardado. */
  function actualizarEnlaceCompartir() {
    var token = getToken();
    var bloque = document.getElementById("sync-share");
    if (!token) { bloque.hidden = true; return; }
    document.getElementById("sync-share-url").textContent =
      location.origin + location.pathname + "#sync=" + token;
    bloque.hidden = false;
  }

  function initSync() {
    var panel = document.getElementById("sync-panel");
    var input = document.getElementById("token-input");

    document.getElementById("btn-sync").addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        setSyncStatus(getToken() ? "guardado" : "sin-token");
        actualizarEnlaceCompartir();
      }
    });

    document.getElementById("btn-sync-save").addEventListener("click", function () {
      var valor = input.value.trim();
      if (!valor) return;
      setToken(valor);
      input.value = "";
      actualizarEnlaceCompartir();
      // Sube el estado actual ya mismo: así el token se valida al
      // momento en vez de esperar al próximo cambio.
      programarSubida();
    });

    document.getElementById("btn-sync-clear").addEventListener("click", function () {
      setToken("");
      input.value = "";
      setSyncStatus("sin-token");
      actualizarEnlaceCompartir();
    });

    document.getElementById("btn-sync-share-copy").addEventListener("click", function () {
      var url = document.getElementById("sync-share-url").textContent;
      var btn = document.getElementById("btn-sync-share-copy");
      navigator.clipboard.writeText(url).then(function () {
        var original = btn.textContent;
        btn.textContent = "Copiado";
        setTimeout(function () { btn.textContent = original; }, 1500);
      }).catch(function () {});
    });
  }

  /* Si la página se abre con "#sync=TOKEN" en la URL (el enlace que
     genera actualizarEnlaceCompartir), guarda ese token en este
     dispositivo y limpia el hash de la barra de direcciones — así el
     token no se queda visible ahí ni viaja si luego se comparte o
     guarda esa URL por error. */
  var tokenPegadoPorEnlace = false;

  function procesarEnlaceSync() {
    if (location.hash.indexOf("sync=") === -1) return;
    var token = new URLSearchParams(location.hash.slice(1)).get("sync");
    if (!token) return;

    setToken(token);
    history.replaceState(null, "", location.pathname + location.search);
    tokenPegadoPorEnlace = true;

    document.getElementById("sync-panel").hidden = false;
    setSyncStatus("guardado");
    actualizarEnlaceCompartir();
  }

  // ============================================================
  // Marcado persistente (localStorage + sincronización opcional)
  // ------------------------------------------------------------
  // La compra y el menú necesitan lo mismo: recordar qué ids están
  // marcados, bajo una clave que cambia con "generated_at" — así, en
  // cuanto generas una lista nueva desde el escritorio, todo empieza
  // destapado otra vez en vez de arrastrar lo marcado la semana
  // anterior. Se construye una fábrica en vez de duplicar esta lógica
  // una vez para la compra y otra para el menú; cada cambio dispara
  // además programarSubida() para intentar sincronizarlo.
  // ============================================================

  function crearAlmacenMarcado(prefijo) {
    var datos = {};
    var key = prefijo + "_sin-fecha";
    return {
      cargar: function (generatedAt) {
        key = prefijo + "_" + (generatedAt || "sin-fecha");
        try { datos = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { datos = {}; }
      },
      reemplazarTodo: function (nuevo) {
        datos = nuevo;
        try { localStorage.setItem(key, JSON.stringify(datos)); } catch (e) {}
      },
      exportar: function () { return datos; },
      estaMarcado: function (id) { return !!datos[id]; },
      marcar: function (id, valor) {
        datos[id] = valor;
        try { localStorage.setItem(key, JSON.stringify(datos)); } catch (e) {}
        programarSubida();
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
    currentGeneratedAt = payload.generated_at;
    comprasMarcadas.cargar(payload.generated_at);
    menuMarcado.cargar(payload.generated_at);

    document.getElementById("lede").innerHTML =
      "Generada el <strong>" + formatFecha(payload.generated_at) + "</strong>.";

    renderAccordion(payload.list || []);
    renderMenu(payload.menu || []);
    showState("content");

    // Lo remoto puede traer marcas hechas desde otro dispositivo desde
    // la última vez que se cargó esta lista aquí: si hay algo nuevo,
    // se repintan las dos vistas con los datos ya actualizados.
    cargarEstadoRemoto(payload.generated_at).then(function (huboCambios) {
      if (!huboCambios) return;
      renderAccordion(payload.list || []);
      renderMenu(payload.menu || []);
    });

    // Si el token se acaba de guardar por el enlace de "#sync=", ya
    // hay generated_at disponible: se valida subiendo el estado ya.
    if (tokenPegadoPorEnlace) {
      tokenPegadoPorEnlace = false;
      programarSubida();
    }
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

  procesarEnlaceSync();
  initSegmented();
  initSync();
  document.getElementById("btn-refresh").addEventListener("click", load);
  load();
})();
