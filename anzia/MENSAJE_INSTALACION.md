Necesito que instales en mi computadora a "Anzia", el bot de turnos por WhatsApp de Posventa ANZER (concesionario oficial Ford San Luis). Usá computer use y el navegador. El código ya está escrito y probado; tu trabajo es instalarlo y configurarlo siguiendo la guía.

Material:
- Repositorio público: https://github.com/zuuchee/zuuchee, rama `claude/vibrant-franklin-lpn23w`, carpeta `anzia/`.
- Guía paso a paso: `anzia/GUIA_INSTALACION.md`. Seguila en orden.
- Código para Apps Script: `anzia/apps-script/Anzia.gs`, `Panel.gs`, `Panel.html`, `appsscript.json`.
- Relay de Cloudflare: `anzia/relay/worker.js`.
- Planilla ya creada en mi Google Drive, con la configuración cargada: "Anzia – Panel de Control", https://docs.google.com/spreadsheets/d/1sGmMaxk63WoX-fXp7-8s--zeO54DGqjZnzMzOjZyg6M/edit
- Excel de precios oficiales del mes: "Detalle_Servicios - OCT26". Preguntame dónde está en mi computadora.

Qué hacer:
1. Pasos 1 y 2 de la guía: pegá el código en Extensiones → Apps Script de la planilla, ejecutá `instalarAnzia` y cargá los precios desde el panel (los dos botones de la pestaña Precios).
2. Paso 3: avisame cuando haya que crear la cuenta de Anthropic. La creo yo y cargo la tarjeta; vos después generás la API key y la guardás en el panel. Probá a Anzia en el simulador con 2 o 3 conversaciones (un service en garantía, un Service Promo fuera de garantía y una distribución) y mostrame cómo respondió.
3. Paso 4: publicá la aplicación web.
4. Paso 5 (Meta): avisame cada vez que haya que iniciar sesión, verificar el negocio, aceptar condiciones o recibir el código por SMS, y lo hago yo. El número es 266 458-8379 y está en WhatsApp Business: buscá la opción para conectar la app existente (coexistencia). Si no aparece, pará y preguntame antes de registrar el número en la API, porque eso lo saca de la app del celular.
5. Paso 6: creá el Worker de Cloudflare (yo creo la cuenta), cargá las 4 variables como secretos y conectá el webhook en Meta, suscripto a "messages".
6. Paso 7: creá la plantilla `recordatorio_turno` con el texto de la guía.
7. Al final, mandame desde mi celular un "Hola" al número para comprobar que Anzia responde, y revisá que el turno de prueba aparezca en el panel y en Google Calendar.

Reglas:
- No subas tokens, claves ni datos bancarios a GitHub ni a ningún lado fuera de mi planilla y las cuentas correspondientes.
- No pagues nada ni aceptes condiciones por mí: avisame y lo hago yo.
- Si algo en pantalla no coincide con la guía, decime qué ves antes de improvisar.
