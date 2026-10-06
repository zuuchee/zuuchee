/**
 * Relay de WhatsApp para Anzia (Cloudflare Worker).
 *
 * Meta necesita que el webhook responda "200 OK" al instante, y Google Apps Script
 * responde con una redirección. Este Worker contesta a Meta enseguida, verifica la
 * firma del mensaje y se lo reenvía a Apps Script.
 *
 * Variables del Worker (Settings → Variables and Secrets):
 *   VERIFY_TOKEN    texto que inventás y cargás también en Meta al configurar el webhook
 *   APP_SECRET      "Clave secreta de la app" de Meta (App settings → Basic)
 *   APPS_SCRIPT_URL URL de la aplicación web de Apps Script (termina en /exec)
 *   CLAVE_RELAY     la clave que muestra el panel de Anzia en Configuración
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const valido = url.searchParams.get('hub.mode') === 'subscribe' &&
        url.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
      return valido ? new Response(url.searchParams.get('hub.challenge')) : new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'POST') {
      const cuerpo = await request.text();
      if (!(await firmaValida(cuerpo, request.headers.get('x-hub-signature-256'), env.APP_SECRET))) {
        return new Response('Firma inválida', { status: 401 });
      }
      const destino = env.APPS_SCRIPT_URL + '?clave=' + encodeURIComponent(env.CLAVE_RELAY);
      ctx.waitUntil(fetch(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: cuerpo,
        redirect: 'follow',
      }));
      return new Response('OK');
    }

    return new Response('Method not allowed', { status: 405 });
  },
};

async function firmaValida(cuerpo, encabezado, secreto) {
  if (!encabezado || !secreto) return false;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const esperado = 'sha256=' + hex;
  if (esperado.length !== encabezado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i++) diferencia |= esperado.charCodeAt(i) ^ encabezado.charCodeAt(i);
  return diferencia === 0;
}
