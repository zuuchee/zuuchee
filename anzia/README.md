# Anzia: bot de turnos por WhatsApp para Posventa ANZER

Asistente que atiende por WhatsApp, cotiza services Ford, agenda turnos en
una agenda virtual y le recuerda el turno al cliente el mismo día.

## Contenido

| Archivo | Qué es |
|---|---|
| `GUIA_INSTALACION.md` | **Empezá por acá**: instalación paso a paso y uso diario |
| `apps-script/Anzia.gs` | El bot: webhook de WhatsApp, conversación con Claude y herramientas (precios, agenda, turnos) |
| `apps-script/Panel.gs` | Panel de control: turnos, recordatorios diarios, carga de precios |
| `apps-script/Panel.html` | La ventana del panel que se abre desde la planilla |
| `apps-script/appsscript.json` | Manifiesto del proyecto de Apps Script |
| `relay/worker.js` | Relay de Cloudflare entre Meta y Apps Script |
| `prompt_anzia.md` | Descripción de la personalidad y del flujo (la versión que usa el bot está en `Anzia.gs`) |
| `herramientas/extraer_precios.py` | Versión en Python del cálculo de precios, para revisar las planillas desde la computadora |

## Actualizar precios cada mes

```bash
pip install openpyxl
python anzia/herramientas/extraer_precios.py Detalle_Servicios.xlsx anzia/datos/precios.json
```

Solo se exportan **precios al público con IVA**. Los costos internos de la
planilla no se exportan. La carpeta `anzia/datos/` y las planillas están en
`.gitignore` porque este repositorio es público.

## Fuentes de datos

| Planilla | Uso en el bot |
|---|---|
| `Detalle_Servicios` (Excel mensual) | Services oficiales Ford por modelo y km, mano de obra, lavado y combos del mes |
| `LISTA DE PRECIOS POSVENTA ANZER` (Google Sheets), pestañas `SERVIS PROMO` y `DISTRIBUCIONES` | Service Promo y reemplazo de distribución |
| `Catalogo de Accesorios Genuinos 2026 Anzer` (Google Sheets) | Accesorios por modelo, para ofrecer cuando el cliente pregunte |

## Número de WhatsApp

El bot atiende en el número del taller, que usa **WhatsApp Business**. Ese
número se conecta a la API oficial de WhatsApp Business (Cloud API) en modo
coexistencia: el equipo sigue viendo y respondiendo los chats desde la app
mientras Anzia atiende automáticamente.
