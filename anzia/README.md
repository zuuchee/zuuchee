# Anzia: bot de turnos por WhatsApp para Posventa ANZER

Asistente que atiende por WhatsApp, cotiza services Ford, agenda turnos en
una agenda virtual y le recuerda el turno al cliente el mismo día.

## Contenido

| Archivo | Qué es |
|---|---|
| `prompt_anzia.md` | Personalidad, flujo de conversación y plantilla de recordatorio |
| `herramientas/extraer_precios.py` | Convierte la planilla mensual de precios en el JSON que usa el bot |

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
