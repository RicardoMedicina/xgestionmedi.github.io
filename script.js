// =================== CONFIG & ESTADO ===================
let baseDatos = JSON.parse(localStorage.getItem('baseDatos')) || [];
let tempDataImportada = []; // preview temporal hasta aceptar
const PIN = "47576671";

const COLS = {
  COD_BARRAS: "Código de Barras",
  COD_PROV: "Código de Proveedor",
  DESC: "Descripción",
  CANT: "Cantidad",
  MIN: "Mínimo",
  MAX: "Máximo",
  PROV: "Proveedor",
  UBIC: "Ubicación",
};

// Track de productos modificados en esta sesión
let modificadosSesion = new Set();
const normalizarCodigo = x => (x ?? '').toString().trim();
function marcarModificado(codAnterior, codNuevo) {
  const a = normalizarCodigo(codAnterior);
  const n = normalizarCodigo(codNuevo);
  if (a) modificadosSesion.delete(a);
  if (n) modificadosSesion.add(n);
}

// =================== INIT ===================
window.addEventListener('load', () => {
  const splash = document.getElementById('splash-screen');
  setTimeout(() => splash && (splash.style.display = 'none'), 2500);

  // Registro del Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.warn('Service Worker no se pudo registrar:', err));
  }
});

function guardarEnLocalStorage() {
  localStorage.setItem('baseDatos', JSON.stringify(baseDatos));
}

// =================== NAV ===================
function navigate(section) {
  const main = document.getElementById('main-content');

  if (section === 'scanner') {
    main.innerHTML = `
      <h2>Escáner</h2>
      <div id="barcode-section">
        <input type="text" id="barcode-input" placeholder="Código de barras..." />
        <button onclick="buscarCodigo()">Buscar por código de barras</button>
        <input type="text" id="proveedor-input" placeholder="Código del proveedor..." />
        <button onclick="buscarPorProveedor()">Buscar por proveedor</button>
      </div>
      <div id="barcode-result" style="margin-top: 1rem;"></div>
    `;

    const bi = document.getElementById('barcode-input');
    const pi = document.getElementById('proveedor-input');
    bi && bi.focus();
    bi && bi.addEventListener('keypress', e => { if (e.key === 'Enter') buscarCodigo(); });
    pi && pi.addEventListener('keypress', e => { if (e.key === 'Enter') buscarPorProveedor(); });
  }

  if (section === 'import') {
    main.innerHTML = `
      <h2>Importar Base de Datos</h2>
      <input type="file" id="file-input" accept=".xlsx, .csv" style="margin-bottom: 1rem;" />
      <button id="aceptar-importacion" style="display:none; margin-bottom: 1rem;">Aceptar Importación</button>
      <div id="import-preview" style="margin-top: 1rem;"></div>
    `;
    document.getElementById('file-input').addEventListener('change', handleFile);
    document.getElementById('aceptar-importacion').addEventListener('click', aceptarImportacion);
    tempDataImportada = [];
  }

  if (section === 'export') {
    exportarExcel();
    main.innerHTML = `<h2>Exportación completada</h2><p>El archivo fue generado.</p>`;
  }

  if (section === 'pedido') {
    const proveedores = [...new Set(baseDatos.map(p => (p[COLS.PROV] || '').toString().trim()).filter(Boolean))];

    main.innerHTML = `
      <h2>Generar Pedido Automático</h2>

      <label for="proveedor-select">Seleccioná un proveedor:</label>
      <select id="proveedor-select">
        <option value="">-- Elegí un proveedor --</option>
        ${proveedores.map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>

      <fieldset>
        <legend>Estrategia de stock</legend>
        <label style="display:block; margin:.25rem 0;">
          <input type="radio" name="estrategia" value="min"> Reponer hasta <strong>Mínimo</strong>
        </label>
        <label style="display:block; margin:.25rem 0;">
          <input type="radio" name="estrategia" value="medio" checked>
          Reponer a <strong>Intermedio</strong> (coeficiente)
        </label>
        <div id="coef-wrapper" style="margin:.5rem 0 0 1.5rem;">
          <label for="coef-input">Coeficiente (0 a 1):</label>
          <input id="coef-input" type="number" min="0" max="1" step="0.05" value="0.5" style="max-width:120px;">
          <small id="coef-hint">→ 0.50 = mitad entre Mínimo y Máximo</small>
        </div>
        <label style="display:block; margin:.25rem 0;">
          <input type="radio" name="estrategia" value="max"> Reponer hasta <strong>Máximo</strong>
        </label>
      </fieldset>

      <button style="margin-top:1rem;" onclick="generarPedidoProveedor()">Generar Pedido</button>
      <button id="btn-no-modificados" style="margin-top:.5rem;">Ver NO modificados del proveedor</button>

      <div id="pedido-resultado" style="margin-top: 1rem;"></div>
      <div id="no-modificados" style="margin-top:.75rem;"></div>
    `;

    // Mostrar/ocultar coeficiente según estrategia
    const radios = Array.from(document.querySelectorAll('input[name="estrategia"]'));
    const coefWrapper = document.getElementById('coef-wrapper');
    function syncCoef() {
      const val = (document.querySelector('input[name="estrategia"]:checked')?.value) || 'medio';
      coefWrapper.style.display = (val === 'medio') ? 'block' : 'none';
    }
    radios.forEach(r => r.addEventListener('change', syncCoef));
    syncCoef();

    document.getElementById('btn-no-modificados')
      .addEventListener('click', mostrarNoModificadosProveedor);
  }
}

// =================== BÚSQUEDA / EDICIÓN ===================
function buscarCodigo() {
  const input = document.getElementById('barcode-input');
  const val = input ? input.value.trim() : '';
  if (input) { input.value = ''; input.focus(); }
  buscarProducto(val, false);
}

function buscarPorProveedor() {
  const input = document.getElementById('proveedor-input');
  const val = input ? input.value.trim() : '';
  if (input) { input.value = ''; input.focus(); }
  buscarProducto(val, true);
}

function buscarProducto(valor, esProveedor = false) {
  const result = document.getElementById('barcode-result');
  if (!valor) return;

  const encontrado = baseDatos.find(item => {
    const cmp = (x) => (x ?? '').toString().trim();
    return esProveedor
      ? cmp(item[COLS.COD_PROV]) === valor
      : cmp(item[COLS.COD_BARRAS]) === valor;
  });

  if (encontrado) {
    const cantidad = Number(encontrado[COLS.CANT]) || 0;
    const maximo  = Number(encontrado[COLS.MAX])  || 0;
    const minimo  = Number(encontrado[COLS.MIN])  || 0;
    const cantidadAPedir = Math.max(0, maximo - cantidad);

    let claseAlerta = '';
    let textoAlerta = '';
    if (cantidad <= minimo) { claseAlerta = 'stock-rojo'; textoAlerta = '¡Alerta! Stock mínimo o agotado'; }
    else if (cantidad < maximo) { claseAlerta = 'stock-azul'; textoAlerta = 'Stock intermedio'; }
    else { claseAlerta = 'stock-verde'; textoAlerta = 'Stock al máximo'; }

    result.innerHTML = `
      <p><strong>Descripción:</strong> ${encontrado[COLS.DESC] ?? ''}</p>
      <p>
        <strong>Stock actual:</strong> ${cantidad}
        <span class="stock-alerta ${claseAlerta}" title="${textoAlerta}"></span>
      </p>
      <p><strong>Proveedor:</strong> ${encontrado[COLS.PROV] ?? ''}</p>
      <p><strong>Ubicación:</strong> ${encontrado[COLS.UBIC] ?? ''}</p>
      <p><strong>Mínimo:</strong> ${minimo}</p>
      <p><strong>Máximo:</strong> ${maximo}</p>
      <p><strong>Cantidad a pedir (a máximo):</strong> ${cantidadAPedir}</p>
      <button onclick="mostrarFormularioEdicion('${(encontrado[COLS.COD_BARRAS] ?? '').toString().replace(/"/g,'&quot;')}')">Editar producto</button>
      <div id="formulario-edicion"></div>
    `;
  } else {
    result.innerHTML = `<p style="color: red;">Producto no encontrado.</p>`;
  }
}

function mostrarFormularioEdicion(codigoBarra) {
  const producto = baseDatos.find(item => (item[COLS.COD_BARRAS] ?? '').toString().trim() === codigoBarra);
  if (!producto) return;

  document.getElementById('formulario-edicion').innerHTML = `
    <form id="edit-form" onsubmit="guardarEdicion(event, '${codigoBarra}')">
      <input type="text" name="${COLS.COD_BARRAS}" value="${producto[COLS.COD_BARRAS] ?? ''}" placeholder="${COLS.COD_BARRAS}" />
      <input type="text" name="${COLS.DESC}" value="${producto[COLS.DESC] ?? ''}" placeholder="${COLS.DESC}" disabled />
      <input type="number" name="${COLS.CANT}" value="${producto[COLS.CANT] ?? 0}" placeholder="Cantidad (stock actual)" />
      <input type="password" id="pin-input" placeholder="Ingresar PIN para editar campos avanzados" autocomplete="off" />
      <input type="number" name="${COLS.MIN}" value="${producto[COLS.MIN] ?? 0}" placeholder="${COLS.MIN}" disabled />
      <input type="number" name="${COLS.MAX}" value="${producto[COLS.MAX] ?? 0}" placeholder="${COLS.MAX}" disabled />
      <input type="text" name="${COLS.PROV}" value="${producto[COLS.PROV] ?? ''}" placeholder="${COLS.PROV}" disabled />
      <input type="text" name="${COLS.UBIC}" value="${producto[COLS.UBIC] ?? ''}" placeholder="${COLS.UBIC}" disabled />
      <button type="submit" id="guardar-btn">Guardar cambios</button>
      <div id="pin-status" style="margin-top:6px; color:#d00;"></div>
    </form>
  `;

  const pinInput = document.getElementById('pin-input');
  pinInput.addEventListener('input', function() {
    const isPinCorrect = pinInput.value === PIN;
    const form = document.getElementById('edit-form');
    [COLS.DESC, COLS.MIN, COLS.MAX, COLS.PROV, COLS.UBIC].forEach(nombre => {
      if (form.elements[nombre]) form.elements[nombre].disabled = !isPinCorrect;
    });
    const status = document.getElementById('pin-status');
    status.textContent = isPinCorrect ? "✔ PIN correcto, podés editar todos los campos." : (pinInput.value.length ? "PIN incorrecto" : "");
    status.style.color = isPinCorrect ? "#080" : "#d00";
  });
}

function guardarEdicion(event, codigoBarraAnterior) {
  event.preventDefault();
  const form = event.target;
  const nuevoCodigo = (form[COLS.COD_BARRAS]?.value ?? '').toString().trim();

  // Duplicado de código de barras
  const codigoDuplicado = baseDatos.some(item =>
    (item[COLS.COD_BARRAS] ?? '').toString().trim() === nuevoCodigo &&
    nuevoCodigo !== (codigoBarraAnterior ?? '').toString().trim()
  );
  if (codigoDuplicado) {
    alert("¡Error! Ya existe un producto con ese código de barras.");
    return;
  }

  const index = baseDatos.findIndex(item => (item[COLS.COD_BARRAS] ?? '').toString().trim() === codigoBarraAnterior);
  if (index === -1) return;

  // Siempre editables
  baseDatos[index][COLS.COD_BARRAS] = nuevoCodigo;
  baseDatos[index][COLS.CANT] = Number(form[COLS.CANT]?.value) || 0;

  // Avanzados si PIN correcto (inputs habilitados)
  if (!form[COLS.DESC].disabled) {
    baseDatos[index][COLS.DESC] = form[COLS.DESC]?.value ?? '';
    baseDatos[index][COLS.MIN]  = Number(form[COLS.MIN]?.value) || 0;
    baseDatos[index][COLS.MAX]  = Number(form[COLS.MAX]?.value) || 0;
    baseDatos[index][COLS.PROV] = form[COLS.PROV]?.value ?? '';
    baseDatos[index][COLS.UBIC] = form[COLS.UBIC]?.value ?? '';
  }

  // Marca como modificado en esta sesión
  marcarModificado(codigoBarraAnterior, nuevoCodigo);

  guardarEnLocalStorage();
  alert("¡Cambios guardados!");
  buscarProducto(nuevoCodigo);
}

// =================== ESTRATEGIAS & PEDIDO ===================
function calcularObjetivo(p, estrategia, coef) {
  const min = Number(p[COLS.MIN]) || 0;
  const max = Number(p[COLS.MAX]) || 0;
  const techo = Math.max(max, min);

  if (estrategia === 'min') return min;
  if (estrategia === 'max') return techo;

  const rango = Math.max(techo - min, 0);
  const c = Math.min(Math.max(coef || 0.5, 0), 1);
  const objetivo = Math.round(min + c * rango);
  return Math.min(Math.max(objetivo, min), techo);
}

function generarPedidoProveedor() {
  const proveedor = (document.getElementById("proveedor-select")?.value ?? '').toString().trim();
  if (!proveedor) return alert("Seleccioná un proveedor");

  const estrategia = (document.querySelector('input[name="estrategia"]:checked')?.value) || 'medio';
  const coef = Number(document.getElementById('coef-input')?.value);
  const coefValido = isNaN(coef) ? 0.5 : Math.min(Math.max(coef, 0), 1);

  const productos = baseDatos.filter(p => {
    const prov = (p[COLS.PROV] ?? '').toString().trim();
    if (prov !== proveedor) return false;
    const objetivo = calcularObjetivo(p, estrategia, coefValido);
    const stock = Number(p[COLS.CANT]) || 0;
    return stock < objetivo;
  });

  const resultado = document.getElementById("pedido-resultado");
  if (productos.length === 0) {
    resultado.innerHTML = `<p>No hay productos por debajo del objetivo para este proveedor.</p>`;
    return;
  }

  const etiqueta = estrategia === 'min' ? 'Mínimo'
                 : estrategia === 'max' ? 'Máximo'
                 : `Intermedio (${coefValido.toFixed(2)})`;

  // Armado del mensaje (ENCODED ya dentro)
  const whatsappTextEncoded = armarWhatsappPedido(proveedor, productos, estrategia, coefValido);

  const mensajePreview = productos.map(p => {
    const objetivo = calcularObjetivo(p, estrategia, coefValido);
    const stock = Number(p[COLS.CANT]) || 0;
    const aPedir = Math.max(0, objetivo - stock);
    const desc = (p[COLS.DESC] ?? '').toString();
    return `🧱 ${desc} | stock: ${stock} → pedir: ${aPedir}`;
  }).join('\n');

  resultado.innerHTML = `
    <p><strong>${productos.length}</strong> productos a pedir de <strong>${proveedor}</strong> con objetivo <strong>${etiqueta}</strong>.</p>
    <button onclick="exportarPedido('${proveedor.replace(/"/g,'&quot;')}', '${estrategia}', ${coefValido})">Exportar Excel</button>
    <button onclick="enviarWhatsappDirecto('${whatsappTextEncoded}')">WhatsApp</button>
    <details style="margin-top:.5rem;">
      <summary>Ver resumen rápido</summary>
      <pre style="white-space:pre-wrap">${mensajePreview}</pre>
    </details>
  `;
}

// =================== EXPORTAR PEDIDO (XLSX) ===================
function exportarPedido(proveedor, estrategia = 'medio', coef = 0.5) {
  const prov = (proveedor ?? '').toString().trim();

  if (typeof XLSX === 'undefined') {
    alert("No se encontró la librería XLSX. Verificá que el <script> de SheetJS esté cargado antes de script.js");
    return;
  }

  const productos = baseDatos.filter(p => {
    const pv = (p[COLS.PROV] ?? '').toString().trim();
    if (pv !== prov) return false;
    const objetivo = calcularObjetivo(p, estrategia, coef);
    const stock = Number(p[COLS.CANT]) || 0;
    return stock < objetivo;
  });

  const etiqueta = estrategia === 'min' ? 'Minimo'
                : estrategia === 'max' ? 'Maximo'
                : `Intermedio_${coef.toFixed(2)}`;

  const dataPedido = (productos.length ? productos : [{}]).map(p => {
    if (!productos.length) return { "Mensaje": "No hubo ítems por debajo del objetivo" };
    const objetivo = calcularObjetivo(p, estrategia, coef);
    const stock = Number(p[COLS.CANT]) || 0;
    const aPedir = Math.max(0, objetivo - stock);
    const noMod = !modificadosSesion.has(normalizarCodigo(p[COLS.COD_BARRAS]));
    return {
      "Estado": noMod ? "NO modificado 🔵" : "Modificado",
      "Código de Proveedor": (p[COLS.COD_PROV] || "").toString(),   // ← CORREGIDO
      "Código de Barras": (p[COLS.COD_BARRAS] ?? '').toString(),
      "Descripción del Artículo": (p[COLS.DESC] || "").toString(),
      "Stock Actual": stock,
      "Objetivo": objetivo,
      "Cantidad a Pedir": aPedir
    };
  });

  const todosDelProveedor = baseDatos.filter(p =>
    (p[COLS.PROV] ?? '').toString().trim() === prov
  );
  const dataMaximos = (todosDelProveedor.length ? todosDelProveedor : [{}]).map(p => {
    if (!todosDelProveedor.length) return { "Mensaje": "Proveedor sin artículos en base" };
    const noMod = !modificadosSesion.has(normalizarCodigo(p[COLS.COD_BARRAS]));
    return {
      "Estado": noMod ? "NO modificado 🔵" : "Modificado",
      "Código de Proveedor": (p[COLS.COD_PROV] || "").toString(),   // ← CORREGIDO
      "Código de Barras": (p[COLS.COD_BARRAS] ?? '').toString(),
      "Descripción": (p[COLS.DESC] ?? '').toString(),
      "Mínimo": Number(p[COLS.MIN]) || 0,
      "Máximo": Number(p[COLS.MAX]) || 0,
      "Ubicación": (p[COLS.UBIC] ?? '').toString()
    };
  });

  try {
    const wb = XLSX.utils.book_new();
    const wsPedido = XLSX.utils.json_to_sheet(dataPedido);
    XLSX.utils.book_append_sheet(wb, wsPedido, "Pedido");
    const wsMaximos = XLSX.utils.json_to_sheet(dataMaximos);
    XLSX.utils.book_append_sheet(wb, wsMaximos, "Maximos");

    const nombre = `Pedido_${prov}_Objetivo_${etiqueta}_Gestion_Medi.xlsx`;
    guardarWorkbook(wb, nombre, "pedido-resultado");
  } catch (err) {
    alert("Ocurrió un error al exportar el pedido: " + err.message);
    console.error("Error al exportar pedido:", err);
  }
}

// =================== NO MODIFICADOS POR PROVEEDOR ===================
function mostrarNoModificadosProveedor() {
  const proveedor = (document.getElementById("proveedor-select")?.value ?? '').toString().trim();
  if (!proveedor) return alert("Primero elegí un proveedor");

  const lista = baseDatos.filter(p =>
    (p[COLS.PROV] ?? '').toString().trim() === proveedor &&
    !modificadosSesion.has(normalizarCodigo(p[COLS.COD_BARRAS]))
  );

  const cont = document.getElementById('no-modificados') || document.getElementById('pedido-resultado');

  if (!lista.length) {
    cont.innerHTML = `<div class="alerta ok">Todos los productos de <strong>${proveedor}</strong> fueron modificados al menos una vez en esta sesión ✅</div>`;
    return;
  }

  const detalle = lista.map(p => {
    const cb = normalizarCodigo(p[COLS.COD_BARRAS]);
    const ds = (p[COLS.DESC] ?? '').toString();
    const ub = ((p[COLS.UBIC] ?? '').toString().trim()) || 'Sin ubicación';
    return `<li class="resaltado-celeste">${ds} — CB: ${cb} — Ubi: ${ub}</li>`;
  }).join('');

  // Texto plano → ENCODE en enviarWhatsapp (prefijo + cuerpo)
  const whatsappTextPlain = lista.map(p => {
    const ds = (p[COLS.DESC] ?? '').toString();
    const cb = normalizarCodigo(p[COLS.COD_BARRAS]);
    const ub = ((p[COLS.UBIC] ?? '').toString().trim()) || 'Sin ubicación';
    return `🔵 ${ds} (CB:${cb}) — Ubi:${ub} — NO modificado`;
  }).join('\n');

  cont.innerHTML = `
    <div class="alerta alerta-amarilla">
      <p><strong>${lista.length}</strong> productos de <strong>${proveedor}</strong> no fueron modificados en esta sesión.</p>
      <details style="margin-top:.5rem;">
        <summary>Ver detalle</summary>
        <ul class="listado-alerta">${detalle}</ul>
      </details>
      <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
        <button onclick="exportarNoModificados('${proveedor.replace(/"/g,'&quot;')}')">Exportar Excel</button>
        <button onclick="enviarWhatsapp( ${JSON.stringify(whatsappTextPlain)} )">WhatsApp</button>
      </div>
    </div>
  `;
}

function exportarNoModificados(proveedor) {
  const prov = (proveedor ?? '').toString().trim();
  const lista = baseDatos.filter(p =>
    (p[COLS.PROV] ?? '').toString().trim() === prov &&
    !modificadosSesion.has(normalizarCodigo(p[COLS.COD_BARRAS]))
  );
  if (!lista.length) return alert("No hay no-modificados para exportar.");

  const data = lista.map(p => ({
    "Estado": "NO modificado 🔵",
    "Código de Proveedor": (p[COLS.COD_PROV] || "").toString(),   // ← CORREGIDO
    "Código de Barras": normalizarCodigo(p[COLS.COD_BARRAS]),
    "Descripción": (p[COLS.DESC] ?? '').toString(),
    "Stock Actual": Number(p[COLS.CANT]) || 0,
    "Mínimo": Number(p[COLS.MIN]) || 0,
    "Máximo": Number(p[COLS.MAX]) || 0,
    "Ubicación": (p[COLS.UBIC] ?? '').toString()
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "No_Modificados");
  guardarWorkbook(wb, `No_Modificados_${prov}_Gestion_Medi.xlsx`, "no-modificados");
}

// =================== IMPORT / EXPORT BASE COMPLETA ===================
function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return alert("No se seleccionó ningún archivo.");

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(hoja);

      if (!json.length) {
        alert("El archivo está vacío o no tiene datos.");
        tempDataImportada = [];
        document.getElementById('aceptar-importacion').style.display = 'none';
        mostrarPreview([]);
        return;
      }

      const columnasMinimas = [COLS.DESC, COLS.CANT, COLS.MIN, COLS.MAX, COLS.PROV, COLS.UBIC, COLS.COD_BARRAS];
      const columnasArchivo = Object.keys(json[0] || {});
      const faltan = columnasMinimas.filter(c => !columnasArchivo.includes(c));
      if (faltan.length > 0) {
        alert("Faltan columnas obligatorias en el archivo:\n" + faltan.join(", "));
        tempDataImportada = [];
        document.getElementById('aceptar-importacion').style.display = 'none';
        mostrarPreview([]);
        return;
      }

      tempDataImportada = json.map(r => ({
        [COLS.COD_BARRAS]: (r[COLS.COD_BARRAS] ?? '').toString().trim(),
        [COLS.DESC]: (r[COLS.DESC] ?? '').toString(),
        [COLS.CANT]: Number(r[COLS.CANT]) || 0,
        [COLS.MIN]: Number(r[COLS.MIN]) || 0,
        [COLS.MAX]: Number(r[COLS.MAX]) || 0,
        [COLS.PROV]: (r[COLS.PROV] ?? '').toString(),
        [COLS.UBIC]: (r[COLS.UBIC] ?? '').toString(),
        [COLS.COD_PROV]: (r[COLS.COD_PROV] ?? r[COLS.PROV] ?? '').toString().trim(), // opcional
      }));

      mostrarPreview(tempDataImportada);
      document.getElementById('aceptar-importacion').style.display = 'block';
    } catch (err) {
      alert("Error al procesar el archivo.\nAsegurate que sea un Excel o CSV válido.\n" + err.message);
      tempDataImportada = [];
      document.getElementById('aceptar-importacion').style.display = 'none';
      mostrarPreview([]);
    }
  };
  reader.readAsArrayBuffer(file);
}

function aceptarImportacion() {
  if (!tempDataImportada.length) return alert("No hay datos para importar.");
  baseDatos = tempDataImportada;
  modificadosSesion = new Set();
  guardarEnLocalStorage();
  alert("¡Base importada correctamente!");
}

function mostrarPreview(data) {
  const contenedor = document.getElementById('import-preview');
  contenedor.innerHTML = `<h3>Vista previa:</h3>`;
  if (!data.length) {
    contenedor.innerHTML += `<p>No se encontraron datos.</p>`;
    return;
  }
  const tabla = document.createElement('table');
  const cabecera = Object.keys(data[0]);
  let html = "<thead><tr>";
  cabecera.forEach(c => html += `<th>${c}</th>`);
  html += "</tr></thead><tbody>";
  data.forEach(fila => {
    html += "<tr>";
    cabecera.forEach(c => html += `<td>${(fila[c] ?? '').toString()}</td>`);
    html += "</tr>";
  });
  html += "</tbody>";
  tabla.innerHTML = html;
  contenedor.appendChild(tabla);
}

function exportarExcel() {
  if (!baseDatos?.length) return alert("No hay datos para exportar.");
  const ws = XLSX.utils.json_to_sheet(baseDatos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Base de Datos");
  guardarWorkbook(wb, `Base_Gestion_Medi.xlsx`, "main-content");
}

// =================== UTIL & WHATSAPP ===================
// ✅ FIX UTF-8: el prefijo se codifica con encodeURIComponent y se concatena al cuerpo (plain)
function enviarWhatsapp(textoPlain) {
  const prefixEncoded = encodeURIComponent('📦 Pedido Automático:\n');
  const bodyEncoded = encodeURIComponent(textoPlain);
  window.open(`https://wa.me/?text=${prefixEncoded}${bodyEncoded}`, "_blank");
}

// Mantengo esta función para cuando YA tenés el cuerpo codificado (como armarWhatsappPedido)
function enviarWhatsappDirecto(textoEncoded) {
  window.open(`https://wa.me/?text=${textoEncoded}`, "_blank");
}

// Helpers de formato para WhatsApp
function fechaCorta() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,'0');
  const mi = String(d.getMinutes()).padStart(2,'0');
  return `${dd}/${mm}/${yy} ${hh}:${mi}`;
}
function abreviar(s, l) {
  s = (s ?? '').toString().replace(/\s+/g,' ').trim();
  return s.length > l ? s.slice(0, l - 1) + '…' : s;
}
function padRight(s, l) {
  s = (s ?? '').toString();
  return s.length >= l ? s.slice(0, l) : s + ' '.repeat(l - s.length);
}
function padLeft(s, l) {
  s = (s ?? '').toString();
  return s.length >= l ? s.slice(-l) : ' '.repeat(l - s.length) + s;
}

/**
 * WhatsApp (ENCODED). Devuelve el CUERPO ya codificado (para usar con enviarWhatsappDirecto).
 * Columnas: CB(13) UBI(6) PED(3) STK(3) DESC(<=28)
 */
function armarWhatsappPedido(proveedor, productos, estrategia, coef) {
  const etiqueta = estrategia === 'min' ? 'Mínimo'
                 : estrategia === 'max' ? 'Máximo'
                 : `Intermedio (${(coef ?? 0.5).toFixed(2)})`;

  let totalUnidades = 0;
  const lineas = productos.map(p => {
    const objetivo = calcularObjetivo(p, estrategia, coef);
    const stock = Number(p[COLS.CANT]) || 0;
    const pedir = Math.max(0, objetivo - stock);
    totalUnidades += pedir;

    const cb  = normalizarCodigo(p[COLS.COD_BARRAS]);
    const ubi = ((p[COLS.UBIC] ?? '') + '').trim() || '-';
    const desc = abreviar(p[COLS.DESC], 28);

    return `${padRight(cb,13)} ${padRight(ubi,6)} ${padLeft(pedir,3)} ${padLeft(stock,3)} ${desc}`;
  });

  const encabezado =
    `🧾 *Pedido Medi*\n` +
    `*Proveedor:* ${proveedor}\n` +
    `*Objetivo:* ${etiqueta}\n` +
    `*Fecha:* ${fechaCorta()}\n` +
    `*Ítems:* ${productos.length}    *Unidades:* ${totalUnidades}\n`;

  const tabla = "```CB           UBI    PED STK DESCRIPCIÓN\n" + lineas.join("\n") + "```";

  // Devuelvo ENCODED (lo usa enviarWhatsappDirecto sin tocar)
  return encodeURIComponent(encabezado + "\n" + tabla);
}

// =================== DESCARGA XLSX (fallback robusto) ===================
function guardarWorkbook(wb, nombre, contenedorId) {
  try {
    if (typeof XLSX.writeFileXLSX === 'function') {
      XLSX.writeFileXLSX(wb, nombre);
    } else {
      XLSX.writeFile(wb, nombre);
    }
    const cont = document.getElementById(contenedorId);
    if (cont) cont.insertAdjacentHTML('beforeend', `<p style="margin-top:.5rem;">✅ Archivo generado: <strong>${nombre}</strong> (revisá Descargas)</p>`);
  } catch (e) {
    try {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const cont = document.getElementById(contenedorId);
      const html = `
        <div style="margin-top:.5rem;">
          ⚠️ Descarga automática bloqueada. Bajalo manual:
          <a href="${url}" download="${nombre}" style="margin-left:.5rem; text-decoration:underline;">Descargar ${nombre}</a>
        </div>`;
      if (cont) cont.insertAdjacentHTML('beforeend', html);
      else window.open(url, "_blank");
    } catch (e2) {
      alert("No se pudo generar el archivo. Probá desde Chrome/Edge, no desde archivo local (file://).");
      console.error("Fallback también falló:", e2);
    }
  }
}
