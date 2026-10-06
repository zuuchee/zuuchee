# Guía de instalación de Anzia

Anzia funciona entera sobre tu cuenta de Google. No hace falta pagar un servidor.

```
Cliente en WhatsApp
      │
      ▼
Meta (API de WhatsApp Business)
      │
      ▼
Relay en Cloudflare (gratis): le contesta "OK" a Meta al instante
      │
      ▼
Google Apps Script (Anzia) ──► Claude (IA)
      │
      ├─► Planilla "Anzia – Panel de Control": turnos, chats, precios, configuración
      ├─► Google Calendar: un evento por turno
      └─► Email al taller: aviso de cada turno nuevo
```

Las cuentas de Meta, Anthropic y Cloudflare tienen que estar **a nombre del concesionario**: piden aceptar condiciones, verificar identidad y cargar un medio de pago. Por eso no las puede crear nadie más que vos.

---

## Paso 1: Pegar el código en la planilla (10 minutos)

La planilla **"Anzia – Panel de Control"** ya está en tu Google Drive, con la configuración cargada.

1. Abrí la planilla y entrá a **Extensiones → Apps Script**.
2. A la izquierda, en **Archivos**, vas a ver `Código.gs`. Borrá todo su contenido y pegá el contenido de `apps-script/Anzia.gs`. Después renombralo a `Anzia` (tres puntitos → Cambiar nombre).
3. Tocá **+ → Secuencia de comandos**, llamala `Panel` y pegá `apps-script/Panel.gs`.
4. Tocá **+ → HTML**, llamalo `Panel` y pegá `apps-script/Panel.html`.
5. Tocá el engranaje **⚙ Configuración del proyecto**, activá **"Mostrar el archivo de manifiesto appsscript.json"**, volvé al editor, abrí `appsscript.json` y reemplazá su contenido por `apps-script/appsscript.json`.
6. Guardá con el ícono del disquete.
7. Arriba, en el selector de funciones, elegí **`instalarAnzia`** y tocá **▶ Ejecutar**. Google te va a pedir permisos: elegí tu cuenta → **Configuración avanzada → Ir a Anzia (no seguro) → Permitir**. Es normal, porque el código es tuyo y no está publicado en el Marketplace de Google.
8. Volvé a la planilla y recargala. Arriba aparece el menú **🤖 Anzia → Abrir panel de control**.

## Paso 2: Cargar los precios (2 minutos)

En el panel, pestaña **Precios**:
1. **Actualizar Service Promo y Distribuciones**: los lee de tu planilla *LISTA DE PRECIOS POSVENTA ANZER*.
2. **Services oficiales y combos**: elegí el Excel *Detalle Servicios* del mes (por ejemplo, `Detalle_Servicios - OCT26.xlsx`) y tocá **Cargar precios del Excel**.

Cada mes, cuando llega la lista nueva, repetís estos dos pasos y listo.

## Paso 3: Cuenta de Anthropic y prueba de Anzia (10 minutos)

1. Entrá a **console.anthropic.com**, creá la cuenta con el email del concesionario y cargá un medio de pago en **Billing** (se paga según el uso).
2. En **API Keys → Create Key**, creá una clave y copiala.
3. En el panel, pestaña **Configuración**, pegala en **API key de Anthropic → Guardar**.
4. Pestaña **Probar a Anzia**: chateá como si fueras un cliente ("Hola, quiero el service de mi Ranger 3.2 2018 con 61.000 km"). No se envía nada por WhatsApp. Usalo para revisar el tono y los precios antes de salir en vivo.

## Paso 4: Publicar el bot como aplicación web (3 minutos)

1. En Apps Script: **Implementar → Nueva implementación**.
2. Tipo: **Aplicación web**. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
3. Tocá **Implementar** y copiá la **URL de la aplicación web** (termina en `/exec`).

Cada vez que cambies el código: **Implementar → Gestionar implementaciones → ✏ → Versión: Nueva → Implementar**. Así la URL no cambia.

## Paso 5: WhatsApp Business en Meta (30 a 60 minutos)

1. Entrá a **business.facebook.com** con la cuenta del concesionario y creá (o usá) la cuenta comercial de ANZER.
2. Entrá a **developers.facebook.com → Mis apps → Crear app → Otro → Empresa**, vinculala a la cuenta comercial y agregá el producto **WhatsApp**.
3. En **WhatsApp → Configuración de la API**, agregá el número **266 458-8379**.
   - Como usás **WhatsApp Business**, fijate si Meta te ofrece **conectar tu app de WhatsApp Business existente** (coexistencia). Así seguís usando la app en el celular mientras Anzia atiende.
   - Si esa opción no aparece, para registrar el número en la API primero hay que borrarlo de la app, y desde entonces los chats se ven solo en el panel. Si preferís no perder la app, se puede usar un número nuevo para Anzia.
4. Anotá el **Identificador del número de teléfono** (Phone number ID) y cargalo en el panel → Configuración → **ID del número de WhatsApp**.
5. **Token permanente:** en **business.facebook.com → Configuración → Usuarios del sistema**, creá un usuario del sistema administrador. Asignale la app y la cuenta de WhatsApp, y generá un token con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Cargalo en el panel → **Token de WhatsApp**.
6. En la app de Meta, **Configuración de la app → Básica**, copiá la **Clave secreta de la app**. La vas a usar en el paso 6.

## Paso 6: Relay en Cloudflare (10 minutos, gratis)

1. Creá una cuenta en **dash.cloudflare.com**. El plan gratuito alcanza.
2. **Workers & Pages → Create → Create Worker**, ponele de nombre `anzia-relay` → **Deploy**.
3. **Edit code**: borrá el contenido, pegá `relay/worker.js` y tocá **Deploy**.
4. En **Settings → Variables and Secrets**, agregá estas cuatro variables (tipo **Secret**):

   | Nombre | Valor |
   |---|---|
   | `VERIFY_TOKEN` | Una palabra que inventes, por ejemplo `anzia-ford-2026` |
   | `APP_SECRET` | La clave secreta de la app de Meta (paso 5.6) |
   | `APPS_SCRIPT_URL` | La URL de la aplicación web (paso 4) |
   | `CLAVE_RELAY` | La clave que muestra el panel en Configuración |

5. Copiá la dirección del Worker (algo como `https://anzia-relay.tu-usuario.workers.dev`).
6. En Meta: **WhatsApp → Configuración → Webhook → Editar**.
   - URL de devolución de llamada: la dirección del Worker.
   - Token de verificación: el mismo `VERIFY_TOKEN`.
   - Tocá **Verificar y guardar** y después **Administrar** → suscribite al campo **messages**.

Desde ese momento, los mensajes que lleguen al número los atiende Anzia.

## Paso 7: Plantilla del recordatorio (5 minutos + aprobación de Meta)

WhatsApp solo deja escribirle libremente a un cliente dentro de las 24 h posteriores a su último mensaje. Para el recordatorio del día del turno se usa una plantilla aprobada.

En **WhatsApp Manager → Plantillas de mensajes → Crear plantilla**:
- Categoría: **Utilidad**
- Nombre: `recordatorio_turno`
- Idioma: **Español (ARG)**
- Cuerpo:

```
¡Hola {{1}}! Te recordamos que hoy a las {{2}} hs tenés turno en ANZER Ford San Luis para el {{3}} de tu {{4}}.
📍 Av. Santos Ortiz 1228, San Luis
💲 Monto estimado: {{5}} (IVA incluido)
💳 Podés pagar en efectivo, por transferencia o con tarjeta de crédito en 3 o 6 cuotas sin interés.
🔩 Acordate de traer la llave de la tuerca de seguridad y la libreta de service. ¡Te esperamos!
```

- Ejemplos de las variables: `Juan`, `09:00`, `service de 32.000 km`, `Territory (AB123CD)`, `$527.850`.
- Botón opcional: **Visitar sitio web** con el link de Google Maps del concesionario.

Los recordatorios salen solos todos los días a las 8 h. La hora se cambia en la hoja **Configuración**.

---

## Uso diario

Menú **🤖 Anzia → Abrir panel de control**:

- **Inicio:** los turnos de hoy, los pendientes de confirmar y los chats que esperan a un asesor.
- **Turnos:** filtrás por fecha y estado. Con los botones confirmás (con aviso por WhatsApp al cliente), marcás como completado, movés de horario, reenviás el recordatorio o cancelás. Cada turno muestra dónde está la tuerca de seguridad, si espera o necesita taxi, los adicionales y la forma de pago.
- **Conversaciones:** todos los chats. Con **🙋 Responder yo** pausás a Anzia con ese cliente y le escribís desde el panel. Con **🤖 Volver a activar a Anzia** retoma ella.
- **Probar a Anzia:** el simulador.
- **Precios:** la actualización mensual.
- **Configuración:** el estado de la instalación y las claves.

Todo lo demás (horarios, autos por horario, feriados, datos bancarios, email de avisos, precio de alineación y balanceo) se edita directamente en las hojas **Configuración** y **Adicionales** de la planilla.

## Costos

- **Google** (Sheets, Apps Script, Calendar): gratis.
- **Cloudflare Workers:** el plan gratuito alcanza para un taller.
- **Anthropic (IA):** se paga por uso, por la cantidad de texto procesado. El consumo se ve en console.anthropic.com → Usage, y ahí podés fijar un límite mensual.
- **Meta (WhatsApp):** cobra los mensajes de plantilla, como el recordatorio. Las respuestas dentro de la ventana de 24 h que abre el cliente no se cobran. Los precios vigentes están en la página de precios de WhatsApp Business.
