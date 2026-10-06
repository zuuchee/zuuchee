/**
 * Anzia: atención por WhatsApp con IA (Claude) para Posventa ANZER.
 * Recibe los mensajes que reenvía el relay (Cloudflare Worker), conversa con el cliente,
 * cotiza con los precios de la planilla y agenda turnos.
 */

const MAX_VUELTAS_HERRAMIENTAS = 8;
const MAX_TEXTO_RESULTADO = 20000;

// ───────────────────────── Webhook ─────────────────────────

function doPost(e) {
  if (!e || !e.parameter || e.parameter.clave !== secreto_('CLAVE_RELAY')) {
    return ContentService.createTextOutput('forbidden');
  }
  let datos;
  try {
    datos = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('bad json');
  }
  (datos.entry || []).forEach(function (entry) {
    (entry.changes || []).forEach(function (cambio) {
      if (cambio.field !== 'messages' || !cambio.value || !cambio.value.messages) return;
      const contacto = (cambio.value.contacts || [])[0] || {};
      cambio.value.messages.forEach(function (m) {
        try {
          recibirMensajeWhatsApp_(m, contacto.profile ? contacto.profile.name : '');
        } catch (err) {
          console.error('Error procesando ' + m.id + ': ' + err + '\n' + err.stack);
        }
      });
    });
  });
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('Anzia está funcionando.');
}

function recibirMensajeWhatsApp_(m, nombre) {
  // Meta reintenta envíos: cada mensaje se procesa una sola vez.
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(300000);
  try {
    if (cache.get('msg_' + m.id)) return;
    cache.put('msg_' + m.id, '1', 21600);
    marcarLeido_(m.id);
    procesarMensaje_({ telefono: m.from, nombre: nombre, texto: textoDeMensaje_(m) });
  } finally {
    lock.releaseLock();
  }
}

function textoDeMensaje_(m) {
  switch (m.type) {
    case 'text': return m.text.body;
    case 'button': return m.button.text;
    case 'interactive':
      return (m.interactive.button_reply || m.interactive.list_reply || {}).title || '[respuesta interactiva]';
    case 'location':
      return '[El cliente compartió una ubicación: ' + m.location.latitude + ', ' + m.location.longitude + ']';
    case 'audio': return '[El cliente envió un audio. No podés escucharlo: pedile amablemente que lo escriba.]';
    case 'image': return '[El cliente envió una imagen' + (m.image.caption ? ' con el texto: ' + m.image.caption : '') + '. No podés verla.]';
    default: return '[El cliente envió un mensaje de tipo ' + m.type + ' que no podés ver.]';
  }
}

// ───────────────────────── Conversación ─────────────────────────

/**
 * Procesa un mensaje entrante y devuelve la respuesta de Anzia.
 * Con `prueba: true` no se envía nada por WhatsApp (lo usa el simulador del panel).
 */
function procesarMensaje_(entrada) {
  const conv = obtenerConversacion_(entrada.telefono, entrada.nombre);
  registrarMensaje_(entrada.telefono, 'Cliente', entrada.texto);
  actualizarCampos_('conversaciones', conv._fila, { 'Último mensaje del cliente': new Date(), 'Último mensaje': new Date() });
  if (conv['Modo'] === 'asesor' && !entrada.prueba) return '';

  const ahora = Utilities.formatDate(new Date(), zona_(), "EEEE dd/MM/yyyy HH:mm");
  const historial = leerHistorial_(entrada.telefono, conv['Conversación']);
  const contenido = '[' + ahora + ' – WhatsApp de ' + (entrada.nombre || 'cliente') + ', ' + entrada.telefono + ']\n' + entrada.texto;
  let ultimo = historial[historial.length - 1];
  if (ultimo && ultimo.role === 'assistant') {
    // Si una respuesta anterior se cortó después de pedir herramientas, se cierran esos pedidos.
    const pendientes = ultimo.content.filter(function (b) { return b.type === 'tool_use'; });
    if (pendientes.length) {
      ultimo = { role: 'user', content: pendientes.map(function (b) {
        return { type: 'tool_result', tool_use_id: b.id, content: 'Interrumpido: no se ejecutó.', is_error: true };
      }) };
      historial.push(ultimo);
      guardarHistorial_(entrada.telefono, conv['Conversación'], ultimo);
    }
  }
  if (ultimo && ultimo.role === 'user') {
    // El turno anterior quedó sin respuesta (por ejemplo, un error): se suma a ese mismo mensaje.
    ultimo.content.push({ type: 'text', text: contenido });
    actualizarUltimoHistorial_(entrada.telefono, conv['Conversación'], ultimo);
  } else {
    const nuevo = { role: 'user', content: [{ type: 'text', text: contenido }] };
    historial.push(nuevo);
    guardarHistorial_(entrada.telefono, conv['Conversación'], nuevo);
  }

  const contexto = { telefono: entrada.telefono, prueba: !!entrada.prueba };
  let respuesta = '';
  for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
    const r = llamarClaude_(promptDeSistema_(), historial, HERRAMIENTAS);
    const mensajeIA = { role: 'assistant', content: r.content };
    historial.push(mensajeIA);
    guardarHistorial_(entrada.telefono, conv['Conversación'], mensajeIA);

    if (r.stop_reason === 'refusal') {
      respuesta = 'Disculpame, con esa consulta te va a ayudar mejor un asesor del taller. Ya le aviso para que te escriba 😊';
      derivarAAsesor_(contexto, 'La IA no pudo responder la consulta.');
      break;
    }
    const textos = r.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; });
    if (r.stop_reason !== 'tool_use') {
      respuesta = textos.join('\n').trim();
      break;
    }
    const resultados = r.content.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) {
      return ejecutarHerramienta_(b, contexto);
    });
    const mensajeResultados = { role: 'user', content: resultados };
    historial.push(mensajeResultados);
    guardarHistorial_(entrada.telefono, conv['Conversación'], mensajeResultados);
  }

  if (!respuesta) respuesta = 'Dame un minuto que lo reviso y te escribo 😊';
  if (!entrada.prueba) enviarTextoWhatsApp_(entrada.telefono, respuesta);
  registrarMensaje_(entrada.telefono, 'Anzia', respuesta);
  return respuesta;
}

function obtenerConversacion_(telefono, nombre) {
  const config = getConfig_();
  const horas = Number(config['Horas para reiniciar conversación']) || 12;
  let conv = leerFilas_('conversaciones').filter(function (c) { return String(c['Teléfono']) === String(telefono); })[0];
  if (!conv) {
    agregarFila_('conversaciones', { 'Teléfono': "'" + telefono, 'Nombre': nombre, 'Último mensaje': new Date(), 'Modo': 'bot',
      'Conversación': Utilities.getUuid(), 'Último mensaje del cliente': new Date() });
    return leerFilas_('conversaciones').filter(function (c) { return String(c['Teléfono']) === String(telefono); })[0];
  }
  const ultimo = conv['Último mensaje del cliente'];
  if (!(ultimo instanceof Date) || Date.now() - ultimo.getTime() > horas * 3600000) {
    conv['Conversación'] = Utilities.getUuid();
    actualizarCampos_('conversaciones', conv._fila, { 'Conversación': conv['Conversación'] });
  }
  if (nombre && !conv['Nombre']) actualizarCampos_('conversaciones', conv._fila, { 'Nombre': nombre });
  return conv;
}

function reiniciarConversacion_(telefono) {
  const conv = obtenerConversacion_(telefono, '');
  actualizarCampos_('conversaciones', conv._fila, { 'Conversación': Utilities.getUuid() });
}

function leerHistorial_(telefono, conversacion) {
  const hoja = hoja_('historial');
  if (hoja.getLastRow() < 2) return [];
  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 4).getValues().filter(function (f) {
    return String(f[0]) === String(telefono) && f[1] === conversacion;
  }).map(function (f) { return JSON.parse(f[3]); });
}

function guardarHistorial_(telefono, conversacion, mensaje) {
  hoja_('historial').appendRow(["'" + telefono, conversacion, new Date(), JSON.stringify(mensaje)]);
}

function actualizarUltimoHistorial_(telefono, conversacion, mensaje) {
  const hoja = hoja_('historial');
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  for (let i = valores.length - 1; i >= 0; i--) {
    if (String(valores[i][0]) === String(telefono) && valores[i][1] === conversacion) {
      hoja.getRange(i + 2, 4).setValue(JSON.stringify(mensaje));
      return;
    }
  }
}

function registrarMensaje_(telefono, quien, texto) {
  agregarFila_('mensajes', { 'Fecha': new Date(), 'Teléfono': "'" + telefono, 'Quién': quien, 'Mensaje': texto });
}

// ───────────────────────── Claude ─────────────────────────

function llamarClaude_(sistema, mensajes, herramientas) {
  const config = getConfig_();
  const cuerpo = {
    model: config['Modelo de IA'] || 'claude-opus-5-5',
    max_tokens: 16000,
    system: [{ type: 'text', text: sistema }],
    tools: herramientas,
    tool_choice: { type: 'auto' },
    messages: mensajes,
    output_config: { effort: config['Esfuerzo de la IA'] || 'low' },
    fallbacks: 'default',
    cache_control: { type: 'ephemeral' },
  };
  const opciones = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': secreto_('ANTHROPIC_API_KEY'),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true,
  };
  for (let intento = 0; intento < 4; intento++) {
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', opciones);
    const codigo = r.getResponseCode();
    if (codigo === 200) return JSON.parse(r.getContentText());
    if (codigo !== 429 && codigo !== 529 && codigo < 500) {
      throw new Error('Error de la API de Claude (' + codigo + '): ' + r.getContentText());
    }
    Utilities.sleep(Math.pow(2, intento) * 2000);
  }
  throw new Error('La API de Claude no respondió después de varios intentos.');
}

function promptDeSistema_() {
  const c = getConfig_();
  const adicionales = leerFilas_('adicionales').map(function (a) {
    return '- ' + a['Concepto'] + ': ' + (Number(a['Precio']) ? pesos_(a['Precio']) : 'sin costo') + (a['Nota'] ? ' (' + a['Nota'] + ')' : '');
  }).join('\n');
  return [
    'Sos ' + c['Nombre del asistente'] + ', del equipo de Posventa de ' + c['Concesionario'] + '. Atendés por WhatsApp a clientes que quieren hacer el service o una reparación de su vehículo Ford y les agendás el turno.',
    '',
    '# Cómo hablás',
    '- Español rioplatense (vos, "dale", "genial"), cálido, cordial y profesional, como una persona del taller.',
    '- Mensajes cortos de WhatsApp: una o dos preguntas por vez, nunca formularios largos ni listas enormes.',
    '- Formato de WhatsApp: *negrita* con un asterisco, sin títulos ni markdown. Emojis con moderación, como mucho uno por mensaje.',
    '- Llamá al cliente por su nombre apenas lo sepas. Saludá según la hora (buen día, buenas tardes, buenas noches).',
    '- Si te preguntan si sos una persona o un bot, respondé con honestidad que sos ' + c['Nombre del asistente'] + ', la asistente virtual de Posventa, y ofrecé pasarlo con un asesor.',
    '- Nunca inventes precios, horarios ni disponibilidad: usá siempre las herramientas. Si algo no está, decí que lo confirma un asesor.',
    '',
    '# Pasos de la conversación',
    '1. Saludo y nombre del cliente.',
    '2. Motivo: service, reparación, ruido o falla, garantía, o un adicional.',
    '3. Vehículo: modelo, versión o motor, año, patente y kilometraje. Preguntá si sigue en garantía.',
    '4. Presupuesto con la herramienta buscar_precios. Ubicá el service que corresponde según el kilometraje (por ejemplo, con 31.500 km corresponde el de 32.000 km).',
    '   - En garantía: service oficial Ford. Hacerlo en término en un concesionario oficial mantiene la garantía.',
    '   - Fuera de garantía: ofrecé elegir entre el Service Promo (más económico: aceite, filtro de aceite, revisión general y lavado) y el service oficial. Nunca ofrezcas el Service Promo a un vehículo en garantía.',
    '   - El lavado es de cortesía y ya está incluido en todos los services: mencionalo como un regalo, nunca lo cobres.',
    '   - Si no sabe qué aceite usa, cotizá 5W30 (sintético).',
    '5. Adicionales, con naturalidad y sin presionar: alineación y balanceo; rotación de neumáticos (sin costo, siempre preguntá si la quiere); combos del mes o distribución si corresponde por kilometraje.',
    '6. Turno: buscá horarios con ver_turnos_disponibles y ofrecé 2 o 3 opciones.',
    '7. Datos: nombre y apellido, email y confirmá que el teléfono de contacto es este WhatsApp.',
    '8. Detalles para el taller:',
    '   - Dónde está la llave de la tuerca de seguridad. Siempre recordale que la traiga: sin ella no se pueden sacar las ruedas.',
    '   - Si va a esperar en el concesionario o necesita taxi al retirarse. No hay convenio con taxis: si lo necesita, el equipo lo ayuda a conseguir uno cuando deje el auto. Nunca prometas que es gratis.',
    '   - Algún ruido, falla o comentario para el técnico.',
    '9. Mandá un resumen del turno y pedí confirmación. Recién cuando confirme, usá registrar_turno.',
    '10. Despedida: contale que el día del turno le llega un recordatorio y que el turno queda sujeto a confirmación del taller.',
    '',
    'Si el cliente quiere cancelar o cambiar un turno, usá consultar_turnos_cliente y después modificar_turno. Si pide hablar con una persona, tiene un reclamo o una consulta que no podés resolver, usá derivar_a_asesor.',
    '',
    '# Datos del concesionario',
    '- Dirección: ' + c['Dirección'] + (c['Link de Google Maps'] ? ' – ' + c['Link de Google Maps'] : ''),
    '- Teléfono: ' + c['Teléfono del taller'],
    '- Horario del taller: lunes a viernes ' + c['Horario lunes a viernes'] + '; sábados ' + (c['Horario sábados'] || 'cerrado') + '; domingos y feriados cerrado.',
    '',
    '# Precios y pagos',
    '- Todos los precios incluyen IVA.',
    '- Medios de pago: ' + c['Medios de pago'] + '.',
    '- Cuenta corriente: solo con autorización previa del concesionario; hay que completar un formulario de apertura. Nunca la des por aprobada.',
    '- Descuento por pago de contado: nunca lo ofrezcas por iniciativa propia. Solo si el cliente pregunta por un descuento pagando de contado, podés ofrecerle un ' + c['Descuento contado (%)'] + '%. No ofrezcas otros porcentajes.',
    '- Transferencias: ' + c['Banco'] + ', titular ' + c['Titular de la cuenta'] + ', CUIT ' + c['CUIT'] + ', cuenta ' + c['Número de cuenta'] + ', CBU ' + c['CBU'] + ', alias ' + c['Alias'] + '. Pasalos solo si el cliente los pide. La transferencia tiene que salir de una cuenta del titular de la operación (si es de un tercero, hace falta una cesión de fondos certificada ante escribano); pedile que verifique que el destinatario sea ' + c['Titular de la cuenta'] + '. Si paga con depósito en efectivo, tiene que presentar el ticket firmado en original.',
    '',
    '# Adicionales',
    adicionales,
  ].join('\n');
}

// ───────────────────────── Herramientas ─────────────────────────

const HERRAMIENTAS = [
  {
    name: 'buscar_precios',
    description: 'Busca precios de services oficiales Ford (por kilometraje), Service Promo (solo fuera de garantía), reemplazo de distribución y combos del mes. Buscá por modelo y motor, por ejemplo "ranger 3.2", "territory", "ecosport sigma".',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Modelo y motor del vehículo' } },
      required: ['consulta'],
      additionalProperties: false,
    },
  },
  {
    name: 'ver_turnos_disponibles',
    description: 'Devuelve los horarios libres del taller a partir de una fecha.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha inicial AAAA-MM-DD' },
        dias: { type: 'integer', description: 'Cuántos días revisar (1 a 14)' },
      },
      required: ['desde', 'dias'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_turno',
    description: 'Agenda el turno cuando el cliente ya confirmó el resumen. Usá texto vacío en los datos que no correspondan.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        hora: { type: 'string', description: 'HH:MM, uno de los horarios libres' },
        cliente: { type: 'string', description: 'Nombre y apellido' },
        email: { type: 'string' },
        vehiculo: { type: 'string', description: 'Modelo, motor y año' },
        patente: { type: 'string' },
        km: { type: 'string' },
        en_garantia: { type: 'boolean' },
        servicio: { type: 'string', description: 'Por ejemplo "Service oficial 32.000 km" o "Service Promo"' },
        adicionales: { type: 'string', description: 'Alineación y balanceo, combos, etc.' },
        rotacion: { type: 'boolean', description: 'Si quiere la rotación de neumáticos' },
        monto_estimado: { type: 'number', description: 'Total estimado en pesos, IVA incluido' },
        forma_pago: { type: 'string' },
        tuerca_seguridad: { type: 'string', description: 'Dónde está la llave de la tuerca de seguridad' },
        espera_o_taxi: { type: 'string', description: 'Espera en el concesionario o necesita taxi' },
        comentarios: { type: 'string' },
      },
      required: ['fecha', 'hora', 'cliente', 'email', 'vehiculo', 'patente', 'km', 'en_garantia', 'servicio', 'adicionales',
        'rotacion', 'monto_estimado', 'forma_pago', 'tuerca_seguridad', 'espera_o_taxi', 'comentarios'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_turnos_cliente',
    description: 'Lista los turnos futuros de este cliente (según su número de WhatsApp).',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'modificar_turno',
    description: 'Cancela o reprograma un turno del cliente. Para reprogramar, primero buscá horarios libres.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        accion: { type: 'string', enum: ['cancelar', 'reprogramar'] },
        nueva_fecha: { type: 'string', description: 'AAAA-MM-DD, vacío si cancela' },
        nueva_hora: { type: 'string', description: 'HH:MM, vacío si cancela' },
      },
      required: ['id', 'accion', 'nueva_fecha', 'nueva_hora'],
      additionalProperties: false,
    },
  },
  {
    name: 'derivar_a_asesor',
    description: 'Pasa la conversación a una persona del taller y pausa las respuestas automáticas con este cliente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
];

function ejecutarHerramienta_(bloque, contexto) {
  let salida, error = false;
  try {
    const entrada = bloque.input || {};
    switch (bloque.name) {
      case 'buscar_precios': salida = buscarPrecios_(entrada.consulta); break;
      case 'ver_turnos_disponibles': salida = verTurnosDisponibles_(entrada.desde, entrada.dias); break;
      case 'registrar_turno': salida = registrarTurno_(entrada, contexto); break;
      case 'consultar_turnos_cliente': salida = consultarTurnosCliente_(contexto); break;
      case 'modificar_turno': salida = modificarTurno_(entrada, contexto); break;
      case 'derivar_a_asesor': salida = derivarAAsesor_(contexto, entrada.motivo); break;
      default: throw new Error('Herramienta desconocida: ' + bloque.name);
    }
  } catch (e) {
    salida = 'Error: ' + e.message;
    error = true;
  }
  if (typeof salida !== 'string') salida = JSON.stringify(salida);
  if (salida.length > MAX_TEXTO_RESULTADO) salida = salida.slice(0, MAX_TEXTO_RESULTADO) + '\n[resultado recortado: pedí una búsqueda más específica]';
  return { type: 'tool_result', tool_use_id: bloque.id, content: salida, is_error: error };
}

function normalizar_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/,/g, '.');
}

/** Puntaje = cantidad de palabras de la consulta que aparecen en el nombre del modelo. */
function coincide_(nombre, palabras) {
  const n = normalizar_(nombre);
  return palabras.filter(function (p) { return n.indexOf(p) >= 0; }).length;
}

function mejores_(filas, campo, palabras) {
  let max = 0;
  filas.forEach(function (f) { f._p = coincide_(f[campo], palabras); max = Math.max(max, f._p); });
  return max === 0 ? [] : filas.filter(function (f) { return f._p === max; });
}

function buscarPrecios_(consulta) {
  const palabras = normalizar_(consulta).split(/\s+/).filter(function (p) { return p.length >= 2; });
  if (!palabras.length) return 'Indicá el modelo del vehículo.';
  const partes = [];

  const oficiales = {};
  mejores_(leerFilas_('oficiales'), 'Modelo', palabras).forEach(function (f) {
    (oficiales[f['Modelo']] = oficiales[f['Modelo']] || []).push(pesos_(f['Km']).slice(1) + ' km: ' + pesos_(f['Precio']));
  });
  Object.keys(oficiales).forEach(function (m) { partes.push('SERVICE OFICIAL FORD – ' + m + '\n' + oficiales[m].join(' | ')); });

  mejores_(leerFilas_('promo'), 'Modelo', palabras).forEach(function (f) {
    partes.push('SERVICE PROMO (solo fuera de garantía) – ' + f['Modelo'] + ': ' + pesos_(f['Precio']) +
      ' (' + f['Litros de aceite'] + ' L ' + f['Viscosidad'] + '). Opcionales: filtro de aire ' + pesos_(f['Filtro aire motor']) +
      ', filtro de combustible ' + pesos_(f['Filtro combustible']) + ', filtro de habitáculo ' + pesos_(f['Filtro habitáculo']) +
      '. Con descuento de contado (solo si lo pide): ' + pesos_(f['Precio contado -10%']));
  });

  mejores_(leerFilas_('distribuciones'), 'Motor', palabras).forEach(function (f) {
    partes.push('DISTRIBUCIÓN – motor ' + f['Motor'] + ': ' + pesos_(f['Precio']) + ' (repuestos y mano de obra). Con descuento de contado (solo si lo pide): ' + pesos_(f['Precio contado -10%']));
  });

  mejores_(leerFilas_('combos'), 'Modelo', palabras).forEach(function (f) {
    partes.push('COMBO DEL MES – ' + f['Acción'] + ' ' + f['Modelo'] + ', ' + f['Opción'] + ': ' + pesos_(f['Precio']));
  });

  if (!partes.length) {
    return 'No encontré precios para "' + consulta + '". Motores con distribución: ' +
      leerFilas_('distribuciones').map(function (f) { return f['Motor']; }).join(', ') +
      '. Si el modelo no está, decile que un asesor le pasa el presupuesto.';
  }
  return partes.join('\n\n');
}

function verTurnosDisponibles_(desde, dias) {
  const n = Math.max(1, Math.min(14, Number(dias) || 7));
  const libres = calcularDisponibilidad_(desde, n, getConfig_(), leerFilas_('turnos'), new Date());
  if (!libres.length) return 'No hay horarios libres en esas fechas. Probá con días siguientes.';
  return libres.map(function (d) { return d.dia + ' (' + d.fecha + '): ' + d.horas.join(', '); }).join('\n');
}

function registrarTurno_(t, contexto) {
  const libres = calcularDisponibilidad_(t.fecha, 1, getConfig_(), leerFilas_('turnos'), new Date());
  if (!libres.length || libres[0].horas.indexOf(fmtHora_(t.hora)) < 0) {
    return 'Ese horario ya no está disponible. Buscá otros horarios con ver_turnos_disponibles.';
  }
  const id = 'T' + Utilities.formatDate(new Date(), zona_(), 'yyMMddHHmmss');
  const turno = {
    'ID': id, 'Creado': new Date(), 'Fecha': t.fecha, 'Hora': fmtHora_(t.hora), 'Estado': 'Pendiente de confirmar',
    'Cliente': t.cliente, 'Teléfono': contexto.telefono, 'Email': t.email, 'Vehículo': t.vehiculo, 'Patente': String(t.patente).toUpperCase(),
    'Km': t.km, 'En garantía': t.en_garantia ? 'Sí' : 'No', 'Servicio': t.servicio, 'Adicionales': t.adicionales,
    'Rotación': t.rotacion ? 'Sí' : 'No', 'Monto estimado': t.monto_estimado, 'Forma de pago': t.forma_pago,
    'Tuerca de seguridad': t.tuerca_seguridad, 'Espera / Taxi': t.espera_o_taxi, 'Comentarios': t.comentarios,
  };
  if (contexto.prueba) {
    // El simulador del panel no toca el calendario ni manda emails.
    turno['Comentarios'] = '[PRUEBA] ' + turno['Comentarios'];
  } else {
    turno['ID evento'] = crearEventoTurno_(turno);
    avisarAlTaller_('Nuevo turno ' + id + ' – ' + t.cliente, describirTurno_(turno));
  }
  agregarFila_('turnos', Object.assign({}, turno, { 'Teléfono': "'" + contexto.telefono }));
  return 'Turno registrado con ID ' + id + ', pendiente de confirmación del taller.';
}

function turnosDelCliente_(telefono) {
  const hoy = Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd');
  return leerFilas_('turnos').filter(function (t) {
    return String(t['Teléfono']) === String(telefono) && fmtFecha_(t['Fecha']) >= hoy && t['Estado'] !== 'Cancelado';
  });
}

function consultarTurnosCliente_(contexto) {
  const turnos = turnosDelCliente_(contexto.telefono);
  if (!turnos.length) return 'Este cliente no tiene turnos próximos.';
  return turnos.map(function (t) {
    return t['ID'] + ': ' + fmtFecha_(t['Fecha']) + ' ' + fmtHora_(t['Hora']) + ' – ' + t['Servicio'] + ' – ' + t['Vehículo'] + ' (' + t['Patente'] + ') – ' + t['Estado'];
  }).join('\n');
}

function modificarTurno_(entrada, contexto) {
  const t = turnosDelCliente_(contexto.telefono).filter(function (x) { return x['ID'] === entrada.id; })[0];
  if (!t) return 'No encontré ese turno entre los turnos de este cliente.';
  if (entrada.accion === 'cancelar') {
    actualizarCampos_('turnos', t._fila, { 'Estado': 'Cancelado' });
    borrarEvento_(t['ID evento']);
    avisarAlTaller_('Turno cancelado ' + t['ID'], describirTurno_(t));
    return 'Turno ' + t['ID'] + ' cancelado.';
  }
  const libres = calcularDisponibilidad_(entrada.nueva_fecha, 1, getConfig_(), leerFilas_('turnos'), new Date());
  if (!libres.length || libres[0].horas.indexOf(fmtHora_(entrada.nueva_hora)) < 0) return 'Ese horario no está disponible.';
  panelReprogramar(t['ID'], entrada.nueva_fecha, fmtHora_(entrada.nueva_hora));
  actualizarCampos_('turnos', t._fila, { 'Estado': 'Pendiente de confirmar' });
  avisarAlTaller_('Turno reprogramado ' + t['ID'], 'Nueva fecha: ' + entrada.nueva_fecha + ' ' + entrada.nueva_hora + '\n\n' + describirTurno_(t));
  return 'Turno ' + t['ID'] + ' reprogramado para el ' + entrada.nueva_fecha + ' a las ' + entrada.nueva_hora + ', pendiente de confirmación.';
}

function derivarAAsesor_(contexto, motivo) {
  if (contexto.prueba) return 'Modo prueba: en una conversación real acá se avisa a un asesor y Anzia deja de responder.';
  const conv = obtenerConversacion_(contexto.telefono, '');
  actualizarCampos_('conversaciones', conv._fila, { 'Modo': 'asesor' });
  avisarAlTaller_('Un cliente necesita un asesor: ' + contexto.telefono, 'Motivo: ' + motivo +
    '\n\nAnzia dejó de responder a este cliente. Respondele desde WhatsApp Business o desde el panel, y cuando termines volvé a activar a Anzia en Conversaciones.');
  return 'Listo: un asesor va a seguir la conversación. Avisale al cliente que en breve le escribe una persona del taller.';
}

function avisarAlTaller_(asunto, cuerpo) {
  const email = getConfig_()['Email para avisos'];
  if (email) MailApp.sendEmail(email, '[Anzia] ' + asunto, cuerpo);
}

// ───────────────────────── WhatsApp ─────────────────────────

function llamarWhatsApp_(cuerpo) {
  const config = getConfig_();
  const url = 'https://graph.facebook.com/' + (config['Versión API WhatsApp'] || 'v23.0') + '/' + secreto_('WHATSAPP_PHONE_ID') + '/messages';
  const r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secreto_('WHATSAPP_TOKEN') },
    payload: JSON.stringify(Object.assign({ messaging_product: 'whatsapp' }, cuerpo)),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('WhatsApp (' + r.getResponseCode() + '): ' + r.getContentText());
  return JSON.parse(r.getContentText());
}

function enviarTextoWhatsApp_(telefono, texto) {
  return llamarWhatsApp_({ to: telefono, type: 'text', text: { body: texto, preview_url: true } });
}

function enviarPlantillaWhatsApp_(telefono, plantilla, idioma, parametros) {
  return llamarWhatsApp_({
    to: telefono,
    type: 'template',
    template: {
      name: plantilla,
      language: { code: idioma || 'es_AR' },
      components: [{ type: 'body', parameters: parametros.map(function (p) { return { type: 'text', text: String(p) }; }) }],
    },
  });
}

function marcarLeido_(idMensaje) {
  try {
    llamarWhatsApp_({ status: 'read', message_id: idMensaje });
  } catch (e) {
    console.warn('No se pudo marcar como leído: ' + e);
  }
}

function enviarYRegistrar_(telefono, texto, quien) {
  enviarTextoWhatsApp_(telefono, texto);
  registrarMensaje_(telefono, quien, texto);
}
