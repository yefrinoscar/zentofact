// Proxy mínimo hacia R2. Autenticado con un bearer secret.
//   PUT  /<key>   -> guarda el body en R2 con esa key
//   GET  /<key>   -> devuelve el objeto
//   HEAD /<key>   -> 200 si existe, 404 si no
//   DELETE /<key> -> borra el objeto
// La "key" es la misma ruta relativa que la app guarda en xml_path / cdr_path,
// ej:  boletas/xml/13052026/B001-000123.xml
export default {
  async fetch(request, env) {
    const auth = request.headers.get('authorization') || '';
    if (!env.PROXY_SECRET || auth !== `Bearer ${env.PROXY_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    if (!key) return new Response('Missing key', { status: 400 });

    switch (request.method) {
      case 'PUT': {
        await env.BUCKET.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
        });
        return new Response('OK', { status: 200 });
      }
      case 'GET': {
        const obj = await env.BUCKET.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          status: 200,
          headers: { 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream' },
        });
      }
      case 'HEAD': {
        const obj = await env.BUCKET.head(key);
        return new Response(null, { status: obj ? 200 : 404 });
      }
      case 'DELETE': {
        await env.BUCKET.delete(key);
        return new Response('OK', { status: 200 });
      }
      default:
        return new Response('Method not allowed', { status: 405 });
    }
  },
};
