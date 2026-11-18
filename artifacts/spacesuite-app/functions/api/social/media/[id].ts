import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonResponse, type PagesContext } from '../../../_shared/cf.ts';
import { getSocialMediaRecord } from '../../../_shared/social.ts';

export async function onRequestGet(
  context: PagesContext<{ id?: string }>,
): Promise<Response> {
  const id = String(context.params.id || '');
  if (!/^[a-f0-9-]{36}$/i.test(id) || typeof context.env.MEDIA_DIR !== 'string') {
    return jsonResponse({ ok: false, error: 'Archivo no encontrado.' }, 404);
  }
  try {
    const media = await getSocialMediaRecord(context.env, id);
    if (!media) return jsonResponse({ ok: false, error: 'Archivo no encontrado.' }, 404);
    const filePath = path.join(context.env.MEDIA_DIR, `${media.id}.${media.extension}`);
    const data = await readFile(filePath);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': media.contentType,
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'public, max-age=3600, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return jsonResponse({ ok: false, error: 'Archivo no encontrado.' }, 404);
  }
}
