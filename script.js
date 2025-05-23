let baseDatos = JSON.parse(localStorage.getItem('baseDatos')) || [];
let tempDataImportada = []; // Guardamos la preview temporal hasta aceptar
const PIN = "47576671";

// Splash Screen (oculta el splash después de 2.5 seg)
window.addEventListener('load', () => {
  const splash = document.getElementById('splash-screen');
  setTimeout(() => {
    splash.style.display = 'none';
  }, 2500);
});

function guardarEnLocalStorage() {
  localStorage.setItem('baseDatos', JSON.stringify(baseDatos));
}

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

    document.getElementById('barcode-input').focus();
    document.getElementById('barcode-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') buscarCodigo();
    });

    document.getElementById('proveedor-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') buscarPorProveedor();
    });
  }

  // --- IMPORTACIÓN MEJORADA ---
  if (section === 'import') {
    main.innerHTML = `
      <h2>Importar Base de Datos</h2>
      <input type="file" id="file-input" accept=".xlsx, .csv" />
      <div id="import-preview" style="margin-top: 1rem;"></div>
      <button id="aceptar-importacion" style="display:none;margin-top:1rem;">Aceptar Importación</button>
    `;
    document.getElementById('file-input').addEventListener('change', handleFile);
    document.getElementById('aceptar-importacion').addEventListener('click', aceptarImportacion);
    tempDataImportada = []; // Limpiar previo import nuevo
  }

  if (section === 'export') {
    exportarExcel();
    main.innerHTML = `<h2>Exportación completada</h2><p>El archivo fue generado.</p>`;
  }

  if (section === 'pedido') {
    const proveedores = [...new Set(baseDatos.map(p => p.Proveedor).filter(Boolean))];
    main.innerHTML = `
      <h2>Generar Pedido Automático</h2>
      <label for="proveedor-select">Seleccioná un proveedor:</label>
      <select id="proveedor-select">
        <option value="">-- Elegí un proveedor --</option>
        ${proveedores.map(p => `<option value="${p}">${p}</option>`).join('')}
      </select>
      <button onclick="generarPedidoProveedor()">Generar Pedido</button>
      <div id="pedido-resultado" style="margin-top: 1rem;"></div>
    `;
  }
}

function buscarCodigo() {
  const input = document.getElementById('barcode-input');
  buscarProducto(input.value.trim());
  input.value = '';
  input.focus();
}

function buscarPorProveedor() {
  const input = document.getElementById('proveedor-input');
  buscarProducto(input.value.trim(), true);
  input.value = '';
  input.focus();
}

// --- ALERTA VISUAL DE STOCK ---
function buscarProducto(valor, esProveedor = false) {
  const result = document.getElementById('barcode-result');
  if (!valor) return;

  const encontrado = baseDatos.find(item =>
    esProveedor
      ? String(item["Código Proveedor"]).trim() === valor
      : String(item["Código de Barras"]).trim() === valor
  );

  if (encontrado) {
    const cantidad = Number(encontrado["Cantidad"]) || 0;
    const maximo = Number(encontrado["Máximo"]) || 0;
    const minimo = Number(encontrado["Mínimo"]) || 0;
    const cantidadAPedir = Math.max(0, maximo - cantidad);

    // Lógica de alerta visual
    let claseAlerta = '';
    let textoAlerta = '';
    if (cantidad <= minimo) {
      claseAlerta = 'stock-rojo';
      textoAlerta = '¡Alerta! Stock mínimo o agotado';
    } else if (cantidad < maximo) {
      claseAlerta = 'stock-azul';
      textoAlerta = 'Stock intermedio';
    } else if (cantidad >= maximo) {
      claseAlerta = 'stock-verde';
      textoAlerta = 'Stock al máximo';
    }

    result.innerHTML = `
      <p><strong>Descripción:</strong> ${encontrado["Descripción"]}</p>
      <p>
        <strong>Stock actual:</strong> ${cantidad}
        <span class="stock-alerta ${claseAlerta}" title="${textoAlerta}"></span>
      </p>
      <p><strong>Proveedor:</strong> ${encontrado["Proveedor"]}</p>
      <p><strong>Ubicación:</strong> ${encontrado["Ubicación"]}</p>
      <p><strong>Mínimo:</strong> ${minimo}</p>
      <p><strong>Máximo:</strong> ${maximo}</p>
      <p><strong>Cantidad a pedir:</strong> ${cantidadAPedir}</p>
      <button onclick="mostrarFormularioEdicion('${encontrado["Código de Barras"]}')">Editar producto</button>
      <div id="formulario-edicion"></div>
    `;
  } else {
    result.innerHTML = `<p style="color: red;">Producto no encontrado.</p>`;
  }
}

function mostrarFormularioEdicion(codigoBarra) {
  const producto = baseDatos.find(item => String(item["Código de Barras"]).trim() === codigoBarra);
  if (!producto) return;

  // Descripción, Mínimo, Máximo, Proveedor, Ubicación: con PIN. Cantidad: siempre editable.
  document.getElementById('formulario-edicion').innerHTML = `
    <form id="edit-form" onsubmit="guardarEdicion(event, '${codigoBarra}')">
      <input type="text" name="Descripción" value="${producto["Descripción"]}" placeholder="Descripción" disabled />
      <input type="number" name="Cantidad" value="${producto["Cantidad"]}" placeholder="Cantidad (stock actual)" />
      <input type="password" id="pin-input" placeholder="Ingresar PIN para editar campos avanzados" autocomplete="off" />
      <input type="number" name="Mínimo" value="${producto["Mínimo"]}" placeholder="Mínimo" disabled />
      <input type="number" name="Máximo" value="${producto["Máximo"]}" placeholder="Máximo" disabled />
      <input type="text" name="Proveedor" value="${producto["Proveedor"]}" placeholder="Proveedor" disabled />
      <input type="text" name="Ubicación" value="${producto["Ubicación"]}" placeholder="Ubicación" disabled />
      <button type="submit" id="guardar-btn">Guardar cambios</button>
      <div id="pin-status" style="margin-top:6px; color:#d00;"></div>
    </form>
  `;

  const pinInput = document.getElementById('pin-input');
  pinInput.addEventListener('input', function(e) {
    const isPinCorrect = pinInput.value === PIN;
    const form = document.getElementById('edit-form');
    // Solo habilita/deshabilita los campos avanzados (no cantidad)
    ["Descripción", "Mínimo", "Máximo", "Proveedor", "Ubicación"].forEach(nombre => {
      form.elements[nombre].disabled = !isPinCorrect;
    });
    // Estado visual
    document.getElementById('pin-status').textContent = isPinCorrect ? "✔ PIN correcto, podés editar todos los campos." : (pinInput.value.length ? "PIN incorrecto" : "");
    document.getElementById('pin-status').style.color = isPinCorrect ? "#080" : "#d00";
  });
}



function guardarEdicion(event, codigoBarra) {
  event.preventDefault();
  const form = event.target;
  const index = baseDatos.findIndex(item => String(item["Código de Barras"]).trim() === codigoBarra);
  if (index === -1) return;

  baseDatos[index]["Descripción"] = form.Descripción.value;
  baseDatos[index]["Cantidad"] = Number(form.Cantidad.value);
  if (!form["Mínimo"].disabled) {
    baseDatos[index]["Mínimo"] = Number(form["Mínimo"].value);
    baseDatos[index]["Máximo"] = Number(form["Máximo"].value);
  }
  baseDatos[index]["Proveedor"] = form.Proveedor.value;
  baseDatos[index]["Ubicación"] = form.Ubicación.value;

  guardarEnLocalStorage();
  alert("¡Cambios guardados!");
  buscarProducto(codigoBarra);
}

function generarPedidoProveedor() {
  const proveedor = document.getElementById("proveedor-select").value;
  if (!proveedor) return alert("Seleccioná un proveedor");

  const productos = baseDatos.filter(p =>
    String(p.Proveedor).trim() === proveedor &&
    Number(p.Cantidad) < Number(p.Mínimo)
  );

  const resultado = document.getElementById("pedido-resultado");

  if (productos.length === 0) {
    resultado.innerHTML = `<p>No hay productos por debajo del mínimo para este proveedor.</p>`;
    return;
  }

  const mensaje = productos.map(p => `🧱 ${p.Descripción} (stock: ${p.Cantidad})`).join('\n');

  resultado.innerHTML = `
    <p><strong>${productos.length}</strong> productos a pedir de <strong>${proveedor}</strong>.</p>
    <button onclick="exportarPedido('${proveedor}')">Exportar Excel</button>
    <button onclick="enviarWhatsapp('${encodeURIComponent(mensaje)}')">WhatsApp</button>
  `;
}

// --- EXPORTACIÓN PEDIDO AUTOMÁTICO SOLO 3 COLUMNAS ---
function exportarPedido(proveedor) {
  const productos = baseDatos.filter(p =>
    String(p.Proveedor).trim() === proveedor &&
    Number(p.Cantidad) < Number(p.Mínimo)
  );

  if (productos.length === 0) {
    alert("No hay productos por debajo del mínimo para este proveedor.");
    return;
  }

  // SOLO las tres columnas pedidas
  const dataFormateada = productos.map(p => ({
    "Código de Proveedor": p["Código Proveedor"] || p["Proveedor"] || "",
    "Descripción del Artículo": p["Descripción"] || "",
    "Cantidad a Pedir": Math.max(0, Number(p["Máximo"]) - Number(p["Cantidad"]))
  }));

  const ws = XLSX.utils.json_to_sheet(dataFormateada);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedido");
  XLSX.writeFile(wb, `Pedido_${proveedor}_Gestion_Medi.xlsx`);
}
// --- FIN EXPORTACIÓN ---

function enviarWhatsapp(texto) {
  window.open(`https://wa.me/?text=📦 Pedido Automático:%0A${texto}`, "_blank");
}

// --- IMPORTACIÓN DE ARCHIVOS EXCEL/CSV MEJORADA ---
function handleFile(event) {
  const file = event.target.files[0];
  if (!file) {
    alert("No se seleccionó ningún archivo.");
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(hoja);

      if (!json.length) {
        alert("El archivo está vacío o no tiene datos.");
        return;
      }

      // Validación de columnas mínimas
      const columnasMinimas = ["Descripción", "Cantidad", "Mínimo", "Máximo", "Proveedor", "Ubicación", "Código de Barras"];
      const columnasArchivo = Object.keys(json[0]);
      const faltan = columnasMinimas.filter(c => !columnasArchivo.includes(c));
      if (faltan.length > 0) {
        alert("Faltan columnas obligatorias en el archivo:\n" + faltan.join(", "));
        tempDataImportada = [];
        document.getElementById('aceptar-importacion').style.display = 'none';
        mostrarPreview([]);
        return;
      }

      tempDataImportada = json;
      mostrarPreview(json);
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
  if (!tempDataImportada.length) {
    alert("No hay datos para importar.");
    return;
  }
  baseDatos = tempDataImportada;
  guardarEnLocalStorage();
  alert("¡Base importada correctamente!");
  // Si querés volver a otra sección automática, podés poner: navigate('scanner');
}

function mostrarPreview(data) {
  const contenedor = document.getElementById('import-preview');
  contenedor.innerHTML = `<h3>Vista previa:</h3>`;
  if (data.length === 0) {
    contenedor.innerHTML += `<p>No se encontraron datos.</p>`;
    return;
  }
  const tabla = document.createElement('table');
  tabla.border = "1";
  const cabecera = Object.keys(data[0]);
  let html = "<thead><tr>";
  cabecera.forEach(c => html += `<th>${c}</th>`);
  html += "</tr></thead><tbody>";
  data.forEach(fila => {
    html += "<tr>";
    cabecera.forEach(c => html += `<td>${fila[c] || ''}</td>`);
    html += "</tr>";
  });
  html += "</tbody>";
  tabla.innerHTML = html;
  contenedor.appendChild(tabla);
}
