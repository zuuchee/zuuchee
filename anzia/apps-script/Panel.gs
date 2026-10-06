/**
 * Anzia: panel de control, turnos, recordatorios y precios.
 * Este archivo se pega en Extensiones → Apps Script de la planilla "Anzia – Panel de Control".
 */

const HOJAS = {
  turnos: 'Turnos',
  conversaciones: 'Conversaciones',
  mensajes: 'Mensajes',
  historial: 'Historial',
  oficiales: 'Precios Oficiales',
  promo: 'Service Promo',
  distribuciones: 'Distribuciones',
  adicionales: 'Adicionales',
  combos: 'Combos del Mes',
  config: 'Configuración',
};

const COLUMNAS = {
  turnos: ['ID', 'Creado', 'Fecha', 'Hora', 'Estado', 'Cliente', 'Teléfono', 'Email', 'Vehículo', 'Patente', 'Km',
    'En garantía', 'Servicio', 'Adicionales', 'Rotación', 'Monto estimado', 'Forma de pago', 'Tuerca de seguridad',
    'Espera / Taxi', 'Comentarios', 'Recordatorio enviado', 'ID evento'],
  conversaciones: ['Teléfono', 'Nombre', 'Último mensaje', 'Modo', 'Conversación', 'Último mensaje del cliente'],
  mensajes: ['Fecha', 'Teléfono', 'Quién', 'Mensaje'],
  historial: ['Teléfono', 'Conversación', 'Fecha', 'JSON'],
  oficiales: ['Modelo', 'Categoría', 'Km', 'Precio'],
  promo: ['Modelo', 'Litros de aceite', 'Viscosidad', 'Precio', 'Precio contado -10%', 'Filtro aire motor',
    'Filtro combustible', 'Filtro habitáculo'],
  distribuciones: ['Motor', 'Horas de mano de obra', 'Precio', 'Precio contado -10%'],
  adicionales: ['Concepto', 'Precio', 'Nota'],
  combos: ['Acción', 'Modelo', 'Opción', 'Precio'],
  config: ['Clave', 'Valor', 'Descripción'],
};

const ESTADOS = ['Pendiente de confirmar', 'Confirmado', 'Completado', 'Cancelado'];

/** Valores iniciales de la hoja Configuración: [clave, valor, descripción]. */
const CONFIG_INICIAL = [
  ['Nombre del asistente', 'Anzia', 'Cómo se presenta el bot'],
  ['Concesionario', 'ANZER – Concesionario Oficial Ford San Luis', ''],
  ['Razón social', 'BORU INVERSIONES S.A.', ''],
  ['Dirección', 'Av. Santos Ortiz 1228, San Luis, Argentina', ''],
  ['Link de Google Maps', '', 'Link que se envía en el recordatorio'],
  ['Teléfono del taller', '266 458-8379', ''],
  ['Horario lunes a viernes', '09:00-13:00, 14:00-18:00', 'Franjas separadas por coma'],
  ['Horario sábados', '09:00-13:00', 'Vacío = cerrado'],
  ['Feriados', '', 'Fechas sin turnos, formato 2026-12-25, separadas por coma'],
  ['Intervalo entre turnos (minutos)', 60, 'Cada cuántos minutos se ofrece un turno'],
  ['Vehículos por horario', 2, 'Cuántos autos se reciben en el mismo horario'],
  ['Días máximos de anticipación', 30, ''],
  ['Anticipación mínima (horas)', 2, 'No se ofrecen turnos antes de este margen'],
  ['Email para avisos', 'postventafordanzer@gmail.com', 'Recibe aviso de cada turno nuevo y de cada derivación'],
  ['ID de calendario', '', 'Vacío = calendario principal de la cuenta'],
  ['Hora del recordatorio', 8, 'Hora del día (0-23) en que salen los recordatorios'],
  ['Recordar turnos pendientes de confirmar', 'Sí', 'Sí / No'],
  ['Plantilla de recordatorio', 'recordatorio_turno', 'Nombre de la plantilla aprobada en Meta'],
  ['Idioma de la plantilla', 'es_AR', ''],
  ['Medios de pago', 'Efectivo; transferencia bancaria; tarjeta de crédito bancaria en 3 y 6 cuotas sin interés; cuenta corriente con autorización previa', ''],
  ['Descuento contado (%)', 10, 'Solo si el cliente lo pide'],
  ['Banco', 'ICBC – Cuenta corriente en pesos', ''],
  ['Titular de la cuenta', 'BORU INVERSIONES S.A.', ''],
  ['CUIT', '', ''],
  ['Número de cuenta', '', ''],
  ['CBU', '', ''],
  ['Alias', '', ''],
  ['Modelo de IA', 'claude-opus-5-5', ''],
  ['Esfuerzo de la IA', 'low', 'low / medium / high. Más alto = más lento y más caro'],
  ['Versión API WhatsApp', 'v23.0', ''],
  ['Horas para reiniciar conversación', 12, 'Después de este tiempo sin mensajes, Anzia empieza una charla nueva'],
  ['ID planilla LISTA DE PRECIOS POSVENTA', '1m21Jzv4fnkdQEF7HPg_wB6ugwRFQ2oZ_UrX-URbxCNM', 'De ahí salen Service Promo y Distribuciones'],
  ['ID planilla Detalle Servicios', '', 'Opcional: link del Excel mensual de Ford guardado como Google Sheets. También podés cargar el Excel desde el panel.'],
  ['Precios actualizados', '', 'Se completa solo'],
];

const ADICIONALES_INICIALES = [
  ['Alineación y balanceo', 55000, ''],
  ['Rotación de neumáticos', 0, 'Incluida en todos los services; preguntar siempre si la quiere'],
  ['Lavado', 0, 'De cortesía, incluido en todos los services'],
];

const SECRETOS = ['ANTHROPIC_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'CLAVE_RELAY'];

// ───────────────────────── Menú e instalación ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🤖 Anzia')
    .addItem('Abrir panel de control', 'abrirPanel')
    .addSeparator()
    .addItem('Instalar / reparar', 'instalarAnzia')
    .addToUi();
}

function abrirPanel() {
  const html = HtmlService.createHtmlOutputFromFile('Panel').setWidth(1200).setHeight(780);
  SpreadsheetApp.getUi().showModalDialog(html, 'Anzia – Panel de control');
}

/** Crea las hojas que falten, guarda el ID de la planilla y programa los recordatorios. No borra datos. */
function instalarAnzia() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  // Si la planilla se creó con la carga inicial, su primera hoja ya trae la configuración.
  const primera = ss.getSheets()[0];
  if (!ss.getSheetByName(HOJAS.config) && primera.getRange('A1').getValue() === 'Clave') primera.setName(HOJAS.config);

  Object.keys(HOJAS).forEach(function (k) {
    let hoja = ss.getSheetByName(HOJAS[k]);
    if (!hoja) hoja = ss.insertSheet(HOJAS[k]);
    if (hoja.getLastRow() === 0) {
      hoja.getRange(1, 1, 1, COLUMNAS[k].length).setValues([COLUMNAS[k]]).setFontWeight('bold');
      hoja.setFrozenRows(1);
    }
  });

  // Borra la hoja vacía que trae toda planilla nueva ("Hoja 1").
  const nuestras = Object.keys(HOJAS).map(function (k) { return HOJAS[k]; });
  ss.getSheets().forEach(function (h) {
    if (nuestras.indexOf(h.getName()) < 0 && h.getLastRow() === 0) ss.deleteSheet(h);
  });

  // Fecha y hora como texto, para que Sheets no las convierta.
  const turnos = ss.getSheetByName(HOJAS.turnos);
  turnos.getRange('C:D').setNumberFormat('@');
  ss.getSheetByName(HOJAS.historial).hideSheet();

  const adicionales = ss.getSheetByName(HOJAS.adicionales);
  if (adicionales.getLastRow() < 2) {
    adicionales.getRange(2, 1, ADICIONALES_INICIALES.length, 3).setValues(ADICIONALES_INICIALES);
  }

  const config = ss.getSheetByName(HOJAS.config);
  const existentes = config.getRange(1, 1, config.getLastRow(), 1).getValues().map(function (f) { return f[0]; });
  CONFIG_INICIAL.forEach(function (fila) {
    if (existentes.indexOf(fila[0]) === -1) config.appendRow(fila);
  });

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLAVE_RELAY')) props.setProperty('CLAVE_RELAY', Utilities.getUuid());

  programarRecordatorios_();
  SpreadsheetApp.getActiveSpreadsheet().toast('Anzia quedó instalada. Abrí el menú 🤖 Anzia → Abrir panel de control.');
}

function programarRecordatorios_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarRecordatoriosDelDia') ScriptApp.deleteTrigger(t);
  });
  const hora = Number(getConfig_()['Hora del recordatorio']) || 8;
  ScriptApp.newTrigger('enviarRecordatoriosDelDia').timeBased().everyDays(1).atHour(hora).create();
}

// ───────────────────────── Utilidades de hojas ─────────────────────────

function libro_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function hoja_(clave) {
  return libro_().getSheetByName(HOJAS[clave]);
}

/** Devuelve las filas de una hoja como objetos {encabezado: valor}, con el número de fila en _fila. */
function leerFilas_(clave) {
  const hoja = hoja_(clave);
  const valores = hoja.getDataRange().getValues();
  const encabezados = valores.shift();
  return valores.map(function (fila, i) {
    const obj = { _fila: i + 2 };
    encabezados.forEach(function (h, j) { obj[h] = fila[j]; });
    return obj;
  });
}

function agregarFila_(clave, obj) {
  const hoja = hoja_(clave);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  hoja.appendRow(encabezados.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function actualizarCampos_(clave, fila, cambios) {
  const hoja = hoja_(clave);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  Object.keys(cambios).forEach(function (h) {
    const col = encabezados.indexOf(h);
    if (col >= 0) hoja.getRange(fila, col + 1).setValue(cambios[h]);
  });
}

function reemplazarDatos_(clave, filas) {
  const hoja = hoja_(clave);
  if (hoja.getLastRow() > 1) hoja.getRange(2, 1, hoja.getLastRow() - 1, hoja.getLastColumn()).clearContent();
  if (filas.length) hoja.getRange(2, 1, filas.length, filas[0].length).setValues(filas);
}

let configCache_ = null;
function getConfig_() {
  if (configCache_) return configCache_;
  const config = {};
  leerFilas_('config').forEach(function (f) { config[f['Clave']] = f['Valor']; });
  configCache_ = config;
  return config;
}

function setConfig_(clave, valor) {
  const fila = leerFilas_('config').filter(function (f) { return f['Clave'] === clave; })[0];
  if (fila) actualizarCampos_('config', fila._fila, { 'Valor': valor });
  else agregarFila_('config', { 'Clave': clave, 'Valor': valor });
  configCache_ = null;
}

function secreto_(nombre) {
  return PropertiesService.getScriptProperties().getProperty(nombre) || '';
}

function zona_() {
  return Session.getScriptTimeZone();
}

function fmtFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zona_(), 'yyyy-MM-dd');
  return String(v || '').trim();
}

function fmtHora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zona_(), 'HH:mm');
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : s;
}

function pesos_(n) {
  if (n === '' || n === null || n === undefined || isNaN(Number(n))) return String(n || '');
  return '$' + Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ───────────────────────── Agenda ─────────────────────────

/** Parsea "09:00-13:00, 14:00-18:00" a [[540, 780], [840, 1080]] en minutos. */
function parsearFranjas_(texto) {
  return String(texto || '').split(',').map(function (f) {
    const m = f.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    return m ? [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])] : null;
  }).filter(Boolean);
}

function franjasDelDia_(fecha, config) {
  const dia = fecha.getDay(); // 0 domingo … 6 sábado
  const feriados = String(config['Feriados'] || '').split(',').map(function (s) { return s.trim(); });
  if (feriados.indexOf(Utilities.formatDate(fecha, zona_(), 'yyyy-MM-dd')) >= 0) return [];
  if (dia === 0) return [];
  if (dia === 6) return parsearFranjas_(config['Horario sábados']);
  return parsearFranjas_(config['Horario lunes a viernes']);
}

/**
 * Horarios libres desde una fecha. Devuelve [{fecha: '2026-10-08', dia: 'jueves 08/10', horas: ['09:00', …]}].
 * `ahora` y `turnos` se pueden pasar para pruebas.
 */
function calcularDisponibilidad_(desde, dias, config, turnos, ahora) {
  const intervalo = Number(config['Intervalo entre turnos (minutos)']) || 60;
  const capacidad = Number(config['Vehículos por horario']) || 1;
  const minimo = new Date(ahora.getTime() + (Number(config['Anticipación mínima (horas)']) || 0) * 3600000);
  const limite = new Date(ahora.getTime() + (Number(config['Días máximos de anticipación']) || 30) * 86400000);
  const ocupados = {};
  turnos.forEach(function (t) {
    if (t['Estado'] === 'Cancelado') return;
    const k = fmtFecha_(t['Fecha']) + ' ' + fmtHora_(t['Hora']);
    ocupados[k] = (ocupados[k] || 0) + 1;
  });
  const nombresDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const resultado = [];
  const p = desde.split('-').map(Number);
  for (let i = 0; i < dias; i++) {
    const fecha = new Date(p[0], p[1] - 1, p[2] + i, 12);
    if (fecha > limite) break;
    const clave = Utilities.formatDate(fecha, zona_(), 'yyyy-MM-dd');
    const horas = [];
    franjasDelDia_(fecha, config).forEach(function (franja) {
      for (let m = franja[0]; m + intervalo <= franja[1]; m += intervalo) {
        const hora = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
        const inicio = new Date(p[0], p[1] - 1, p[2] + i, Math.floor(m / 60), m % 60);
        if (inicio < minimo) continue;
        if ((ocupados[clave + ' ' + hora] || 0) >= capacidad) continue;
        horas.push(hora);
      }
    });
    if (horas.length) {
      resultado.push({ fecha: clave, dia: nombresDia[fecha.getDay()] + ' ' + Utilities.formatDate(fecha, zona_(), 'dd/MM'), horas: horas });
    }
  }
  return resultado;
}

function calendario_() {
  const id = getConfig_()['ID de calendario'];
  return id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
}

function crearEventoTurno_(t) {
  const config = getConfig_();
  const p = fmtFecha_(t['Fecha']).split('-').map(Number);
  const h = fmtHora_(t['Hora']).split(':').map(Number);
  const inicio = new Date(p[0], p[1] - 1, p[2], h[0], h[1]);
  const fin = new Date(inicio.getTime() + (Number(config['Intervalo entre turnos (minutos)']) || 60) * 60000);
  const titulo = '🔧 ' + t['Servicio'] + ' – ' + t['Cliente'] + ' (' + t['Patente'] + ')';
  const evento = calendario_().createEvent(titulo, inicio, fin, { description: describirTurno_(t) });
  return evento.getId();
}

function borrarEvento_(id) {
  if (!id) return;
  try {
    const evento = calendario_().getEventById(id);
    if (evento) evento.deleteEvent();
  } catch (e) {
    console.warn('No se pudo borrar el evento ' + id + ': ' + e);
  }
}

function describirTurno_(t) {
  return [
    'Turno ' + t['ID'] + ' – ' + t['Estado'],
    'Fecha: ' + fmtFecha_(t['Fecha']) + ' ' + fmtHora_(t['Hora']),
    'Cliente: ' + t['Cliente'] + ' – Tel: ' + t['Teléfono'] + ' – ' + t['Email'],
    'Vehículo: ' + t['Vehículo'] + ' – Patente: ' + t['Patente'] + ' – Km: ' + t['Km'],
    'En garantía: ' + t['En garantía'],
    'Servicio: ' + t['Servicio'],
    'Adicionales: ' + t['Adicionales'] + ' – Rotación: ' + t['Rotación'],
    'Monto estimado: ' + pesos_(t['Monto estimado']) + ' – Pago: ' + t['Forma de pago'],
    'Tuerca de seguridad: ' + t['Tuerca de seguridad'],
    'Espera / Taxi: ' + t['Espera / Taxi'],
    'Comentarios: ' + t['Comentarios'],
  ].join('\n');
}

// ───────────────────────── Recordatorios ─────────────────────────

/** Se ejecuta todos los días a la "Hora del recordatorio". */
function enviarRecordatoriosDelDia() {
  const config = getConfig_();
  const hoy = Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd');
  const incluirPendientes = String(config['Recordar turnos pendientes de confirmar']).toLowerCase().indexOf('s') === 0;
  leerFilas_('turnos').forEach(function (t) {
    if (fmtFecha_(t['Fecha']) !== hoy || t['Recordatorio enviado']) return;
    if (t['Estado'] !== 'Confirmado' && !(incluirPendientes && t['Estado'] === 'Pendiente de confirmar')) return;
    try {
      enviarRecordatorio_(t);
    } catch (e) {
      console.error('Recordatorio ' + t['ID'] + ': ' + e);
    }
  });
}

function enviarRecordatorio_(t) {
  const config = getConfig_();
  enviarPlantillaWhatsApp_(String(t['Teléfono']), config['Plantilla de recordatorio'], config['Idioma de la plantilla'], [
    String(t['Cliente']).split(' ')[0],
    fmtHora_(t['Hora']),
    String(t['Servicio']),
    t['Vehículo'] + ' (' + t['Patente'] + ')',
    pesos_(t['Monto estimado']),
  ]);
  actualizarCampos_('turnos', t._fila, { 'Recordatorio enviado': Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd HH:mm') });
  registrarMensaje_(String(t['Teléfono']), 'Anzia', '[Recordatorio de turno enviado]');
}

// ───────────────────────── Precios ─────────────────────────

/** Recalcula Service Promo y Distribuciones con la Lista de Precios FORD (columna D, con IVA). */
function actualizarPreciosPosventa() {
  const config = getConfig_();
  const lista = SpreadsheetApp.openById(idDe_(config['ID planilla LISTA DE PRECIOS POSVENTA']));
  const precios = {};
  lista.getSheetByName('Lista de Precios FORD').getRange('A:D').getValues().forEach(function (f) {
    if (f[0] && typeof f[3] === 'number') precios[String(f[0]).trim().toUpperCase()] = f[3];
  });
  const promo = lista.getSheetByName('SERVIS PROMO ') || lista.getSheetByName('SERVIS PROMO');
  const dist = lista.getSheetByName('DISTRIBUCIONES');
  const r = calcularPromoYDistribucion_(promo.getRange('A1:J40').getValues(), dist.getRange('A1:O40').getValues(), precios);
  reemplazarDatos_('promo', r.promo);
  reemplazarDatos_('distribuciones', r.distribuciones);
  setConfig_('Precios actualizados', 'Promo/Distribución: ' + Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd HH:mm'));
  return 'Service Promo: ' + r.promo.length + ' modelos. Distribuciones: ' + r.distribuciones.length + ' motores.';
}

function redondear100_(x) {
  return Math.floor(x / 100 + 0.5) * 100;
}

/**
 * Misma lógica que la planilla de Posventa (pestañas SERVIS PROMO y DISTRIBUCIONES).
 * `promo` y `dist` son las celdas desde A1; `precios` es código → precio con IVA.
 */
function calcularPromoYDistribucion_(promo, dist, precios) {
  function pieza(codigo, obligatoria) {
    const c = String(codigo || '').trim().toUpperCase();
    if (c === '' || c === '-') return 0;
    if (!(c in precios)) {
      if (obligatoria) throw new Error('La pieza ' + c + ' no está en la Lista de Precios FORD');
      return null;
    }
    return precios[c];
  }
  // Fila n de la planilla = índice n-1; columna B = 1, C = 2, …
  const aceite = {};
  aceite[String(promo[24][1]).trim().toUpperCase()] = promo[24][2]; // B25:C25
  aceite[String(promo[25][1]).trim().toUpperCase()] = promo[25][2]; // B26:C26
  const manoDeObraPromo = promo[33][6]; // G34

  const filasPromo = [];
  for (let f = 1; f <= 22; f++) {
    const fila = promo[f];
    if (!fila || !fila[1]) continue;
    const litros = Number(fila[2]);
    const repuestos = litros * aceite[String(fila[3]).trim().toUpperCase()] + pieza(fila[5], true);
    const precio = redondear100_(repuestos) + manoDeObraPromo;
    const opcional = function (c) { const p = pieza(c, false); return p === null ? 'Consultar' : Math.round(p); };
    filasPromo.push([String(fila[1]).trim(), litros, String(fila[3]).trim().toUpperCase(), precio,
      redondear100_(precio * 0.9), opcional(fila[6]), opcional(fila[7]), opcional(fila[8])]);
  }

  const hora = dist[18][6]; // G19
  const litroAceite = promo[24][2]; // 5W30
  const reten = dist[24][3]; // D25: retén delantero de cigüeñal, lo llevan todos los motores
  const filasDist = [];
  for (let f = 1; f <= 13; f++) {
    const fila = dist[f];
    if (!fila || !fila[1]) continue;
    const litros = typeof fila[2] === 'number' ? fila[2] : 0;
    let repuestos = litros * litroAceite + reten + pieza(fila[12], true) * 2; // 2 bidones de refrigerante
    // Correa, tensor, bomba de agua, junta, correa poli V, correa bomba de aceite, filtro (columnas E a K)
    for (let c = 4; c <= 10; c++) repuestos += pieza(fila[c], true);
    const precio = redondear100_(repuestos + 20) + Number(fila[13]) * hora;
    filasDist.push([String(fila[1]).trim(), Number(fila[13]), precio, redondear100_(precio * 0.9)]);
  }
  return { promo: filasPromo, distribuciones: filasDist };
}

/** Acepta un ID o un link de Google Sheets. */
function idDe_(texto) {
  const m = String(texto || '').match(/\/d\/([\w-]{20,})/);
  return m ? m[1] : String(texto || '').trim();
}

/** Lee los services oficiales del Excel mensual de Ford guardado como Google Sheets. */
function actualizarPreciosOficiales() {
  const id = idDe_(getConfig_()['ID planilla Detalle Servicios']);
  if (!id) throw new Error('Falta completar "ID planilla Detalle Servicios" en Configuración, o cargá el Excel desde el panel.');
  const libro = SpreadsheetApp.openById(id);
  return cargarOficiales_(function (nombre) {
    const hoja = libro.getSheetByName(nombre);
    return hoja ? hoja.getDataRange().getValues() : null;
  });
}

/** El panel lee el Excel de Ford en el navegador y manda {nombreDeHoja: filas}. */
function panelCargarExcelOficiales(hojas) {
  return cargarOficiales_(function (nombre) { return hojas[nombre] || null; });
}

const HOJAS_EXCEL_FORD = ['New Portfolio', 'Old Portfolio', 'Precios Vigentes Electricos', 'Oport Mecanica Lig'];

function cargarOficiales_(leerHoja) {
  const filas = [];
  HOJAS_EXCEL_FORD.slice(0, 3).forEach(function (nombre) {
    const valores = leerHoja(nombre);
    if (valores) parsearPortfolio_(valores).forEach(function (f) { filas.push(f); });
  });
  if (!filas.length) throw new Error('No encontré precios: ¿es el Excel "Detalle Servicios" de Ford?');
  reemplazarDatos_('oficiales', filas);
  const combos = leerHoja('Oport Mecanica Lig');
  if (combos) reemplazarDatos_('combos', parsearCombos_(combos));
  setConfig_('Precios actualizados', 'Oficiales: ' + Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd HH:mm'));
  return 'Services oficiales: ' + filas.length + ' precios cargados.';
}

const CATEGORIAS_ = ['AUTOS', 'SUV´S', 'PICKS-UPS', 'PERFORMANCE', 'COMERCIALES', 'UTILITARIOS'];

function parsearPortfolio_(valores) {
  const filas = [];
  let categoria = '', kms = [];
  valores.forEach(function (row) {
    const c = row.slice(1);
    if (typeof c[0] === 'string' && CATEGORIAS_.indexOf(c[0].trim()) >= 0) { categoria = c[0].trim(); return; }
    const nums = c.slice(2).filter(function (x) { return typeof x === 'number'; });
    if (c[0] === '' && nums.length >= 5 && nums.every(function (n) { return n < 1000; })) {
      kms = nums.map(function (n) { return n * 1000; });
      return;
    }
    if (c[1] === 'Fidelidad Ford' && c[0]) {
      const modelo = String(c[0]).replace(/\s+/g, ' ').trim();
      kms.forEach(function (km, i) {
        const precio = c[2 + i];
        if (typeof precio === 'number' && precio > 0) filas.push([modelo, categoria, km, Math.round(precio)]);
      });
    }
  });
  return filas;
}

function parsearCombos_(valores) {
  const filas = [];
  let accion = null, opciones = [];
  valores.forEach(function (row) {
    const c = row.slice(1);
    const texto = String(c[0] || '').trim();
    if (texto.indexOf('Accion') === 0) {
      accion = texto.replace('Accion', 'Combo').trim();
      opciones = c.slice(1).map(function (x) { return String(x || '').trim(); });
    } else if (texto.indexOf('Distir') === 0) {
      accion = null;
    } else if (accion && texto) {
      c.slice(1).forEach(function (precio, i) {
        if (typeof precio === 'number' && precio > 0) filas.push([accion, texto, opciones[i] || 'Precio', Math.round(precio)]);
      });
    }
  });
  return filas;
}

// ───────────────────────── Funciones que usa el panel ─────────────────────────

function panelResumen() {
  const hoy = Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd');
  const turnos = leerFilas_('turnos').map(turnoParaPanel_);
  const convs = leerFilas_('conversaciones');
  return {
    hoy: hoy,
    turnosHoy: turnos.filter(function (t) { return t.Fecha === hoy && t.Estado !== 'Cancelado'; }),
    pendientes: turnos.filter(function (t) { return t.Estado === 'Pendiente de confirmar' && t.Fecha >= hoy; }).length,
    proximos: turnos.filter(function (t) { return t.Fecha >= hoy && t.Estado !== 'Cancelado'; }).length,
    conAsesor: convs.filter(function (c) { return c['Modo'] === 'asesor'; }).length,
  };
}

function turnoParaPanel_(t) {
  const o = {};
  Object.keys(t).forEach(function (k) { o[k] = t[k] instanceof Date ? Utilities.formatDate(t[k], zona_(), 'yyyy-MM-dd HH:mm') : t[k]; });
  o.Fecha = fmtFecha_(t['Fecha']);
  o.Hora = fmtHora_(t['Hora']);
  return o;
}

function panelTurnos(desde, hasta, estado) {
  return leerFilas_('turnos').map(turnoParaPanel_).filter(function (t) {
    return (!desde || t.Fecha >= desde) && (!hasta || t.Fecha <= hasta) && (!estado || t.Estado === estado);
  }).sort(function (a, b) { return (a.Fecha + a.Hora).localeCompare(b.Fecha + b.Hora); });
}

function buscarTurno_(id) {
  const t = leerFilas_('turnos').filter(function (f) { return f['ID'] === id; })[0];
  if (!t) throw new Error('No existe el turno ' + id);
  return t;
}

function panelCambiarEstado(id, estado, avisarCliente) {
  if (ESTADOS.indexOf(estado) < 0) throw new Error('Estado inválido');
  const t = buscarTurno_(id);
  actualizarCampos_('turnos', t._fila, { 'Estado': estado });
  if (estado === 'Cancelado') borrarEvento_(t['ID evento']);
  if (avisarCliente) {
    const nombre = String(t['Cliente']).split(' ')[0];
    const textos = {
      'Confirmado': '¡Hola ' + nombre + '! Te confirmo tu turno en ANZER para el ' + fmtFecha_(t['Fecha']).split('-').reverse().join('/') +
        ' a las ' + fmtHora_(t['Hora']) + ' hs. Acordate de traer la llave de la tuerca de seguridad. ¡Te esperamos! 😊',
      'Cancelado': '¡Hola ' + nombre + '! Te escribo de ANZER: tu turno del ' + fmtFecha_(t['Fecha']).split('-').reverse().join('/') +
        ' quedó cancelado. Si querés, respondeme y te busco otro día.',
    };
    if (textos[estado]) enviarYRegistrar_(String(t['Teléfono']), textos[estado], 'Asesor');
  }
  return 'Turno ' + id + ': ' + estado;
}

function panelReprogramar(id, fecha, hora) {
  const t = buscarTurno_(id);
  borrarEvento_(t['ID evento']);
  t['Fecha'] = fecha;
  t['Hora'] = hora;
  const evento = crearEventoTurno_(t);
  actualizarCampos_('turnos', t._fila, { 'Fecha': fecha, 'Hora': hora, 'ID evento': evento, 'Recordatorio enviado': '' });
  return 'Turno ' + id + ' movido al ' + fecha + ' ' + hora;
}

function panelEnviarRecordatorio(id) {
  enviarRecordatorio_(buscarTurno_(id));
  return 'Recordatorio enviado';
}

function panelConversaciones() {
  return leerFilas_('conversaciones').map(function (c) {
    return { telefono: String(c['Teléfono']), nombre: c['Nombre'], modo: c['Modo'] || 'bot',
      ultimo: c['Último mensaje'] instanceof Date ? Utilities.formatDate(c['Último mensaje'], zona_(), 'yyyy-MM-dd HH:mm') : String(c['Último mensaje']) };
  }).sort(function (a, b) { return b.ultimo.localeCompare(a.ultimo); });
}

function panelMensajes(telefono) {
  return leerFilas_('mensajes').filter(function (m) { return String(m['Teléfono']) === String(telefono); }).slice(-200).map(function (m) {
    return { fecha: m['Fecha'] instanceof Date ? Utilities.formatDate(m['Fecha'], zona_(), 'dd/MM HH:mm') : String(m['Fecha']), quien: m['Quién'], texto: m['Mensaje'] };
  });
}

function panelCambiarModo(telefono, modo) {
  const c = obtenerConversacion_(telefono, '');
  actualizarCampos_('conversaciones', c._fila, { 'Modo': modo === 'asesor' ? 'asesor' : 'bot' });
  return modo === 'asesor' ? 'Ahora respondés vos; Anzia queda en pausa con este cliente.' : 'Anzia vuelve a responder a este cliente.';
}

function panelEnviarMensaje(telefono, texto) {
  enviarYRegistrar_(telefono, texto, 'Asesor');
  return 'Mensaje enviado';
}

function panelEstado() {
  const props = PropertiesService.getScriptProperties();
  const estado = {};
  SECRETOS.forEach(function (s) { estado[s] = !!props.getProperty(s); });
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  return {
    secretos: estado,
    urlWebApp: url,
    claveRelay: props.getProperty('CLAVE_RELAY') || '',
    recordatorios: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'enviarRecordatoriosDelDia'; }),
    precios: getConfig_()['Precios actualizados'] || '',
  };
}

function panelGuardarSecreto(nombre, valor) {
  if (SECRETOS.indexOf(nombre) < 0) throw new Error('Dato desconocido');
  PropertiesService.getScriptProperties().setProperty(nombre, String(valor).trim());
  return 'Guardado';
}

function panelProbar(texto, reiniciar) {
  if (reiniciar) reiniciarConversacion_('PRUEBA');
  return procesarMensaje_({ telefono: 'PRUEBA', nombre: 'Cliente de prueba', texto: texto, prueba: true });
}

function panelActualizarPrecios(cual) {
  return cual === 'oficiales' ? actualizarPreciosOficiales() : actualizarPreciosPosventa();
}
