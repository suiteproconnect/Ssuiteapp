import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonResponse, type PagesContext } from '../../_shared/cf.ts';
import { requireAuth } from '../../_shared/auth.ts';
import { createSocialMediaRecord, getSocialDb } from '../../_shared/social.ts';

const ALLOWED_MEDIA: Record<string, { extension: string; kind: 'image' | 'video'; limit: number }> = {
  'image/jpeg': { extension: 'jpg', kind: 'image', limit: 12 * 1024 * 1024 },
  'image/png': { extension: 'png', kind: 'image', limit: 12 * 1024 * 1024 },
  'image/webp': { extension: 'webp', kind: 'image', limit: 12 * 1024 * 1024 },
  'image/gif': { extension: 'gif', kind: 'image', limit: 12 * 1024 * 1024 },
  'video/mp4': { extension: 'mp4', kind: 'video', limit: 24 * 1024 * 1024 },
  'video/webm': { extension: 'webm', kind: 'video', limit: 24 * 1024 * 1024 },
};

function hasExpectedSignature(data: Uint8Array, contentType: string): boolean {
  if (contentType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (contentType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => data[index] === byte);
  }
  if (contentType === 'image/gif') {
    return String.fromCharCode(...data.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...data.slice(0, 6)) === 'GIF89a';
  }
  if (contentType === 'image/webp') {
    return String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP';
  }
  if (contentType === 'video/mp4') return String.fromCharCode(...data.slice(4, 8)) === 'ftyp';
  if (contentType === 'video/webm') return data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
  return false;
}

async function authenticatedUser(context: PagesContext) {
  return requireAuth({
    request: context.request,
    env: context.env,
    params: {},
    next: context.next,
  });
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const auth = await authenticatedUser(context);
  if ('errorResponse' in auth) return auth.errorResponse;

  const contentType = (context.request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const spec = ALLOWED_MEDIA[contentType];
  if (!spec) return jsonResponse({ ok: false, error: 'Formato no admitido. Usa JPG, PNG, WebP, GIF, MP4 o WebM.' }, 415);
  const data = new Uint8Array(await context.request.arrayBuffer());
  if (!data.byteLength || data.byteLength > spec.limit) {
    return jsonResponse({ ok: false, error: `El archivo supera el límite de ${Math.round(spec.limit / 1024 / 1024)} MB.` }, 413);
  }
  if (!hasExpectedSignature(data, contentType)) {
    return jsonResponse({ ok: false, error: 'El archivo no coincide con el formato indicado.' }, 415);
  }

  const purpose = context.request.headers.get('X-Media-Purpose') === 'avatar' ? 'avatar' : 'post';
  if (purpose === 'avatar' && spec.kind !== 'image') {
    return jsonResponse({ ok: false, error: 'La foto de perfil debe ser una imagen.' }, 415);
  }
  if (!context.env.DB || typeof context.env.MEDIA_DIR !== 'string') {
    return jsonResponse({ ok: false, error: 'El almacenamiento multimedia no está disponible.' }, 503);
  }

  const id = crypto.randomUUID();
  const mediaDir = context.env.MEDIA_DIR;
  const filePath = path.join(mediaDir, `${id}.${spec.extension}`);
  const rawName = context.request.headers.get('X-File-Name') || `archivo.${spec.extension}`;
  const fileName = rawName.split(/[\\/]/).pop()?.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 100) || `archivo.${spec.extension}`;

  try {
    await getSocialDb(context.env);
    await mkdir(mediaDir, { recursive: true });
    await writeFile(filePath, data, { flag: 'wx' });
    const media = await createSocialMediaRecord(context.env, {
      id,
      ownerId: auth.user.id,
      purpose,
      kind: spec.kind,
      contentType,
      extension: spec.extension,
      size: data.byteLength,
      fileName,
    });
    return jsonResponse({
      ok: true,
      media: {
        id: media.id,
        kind: media.kind,
        size: media.size,
        url: `/api/social/media/${encodeURIComponent(media.id)}`,
      },
    }, 201);
  } catch {
    await unlink(filePath).catch(() => {});
    return jsonResponse({ ok: false, error: 'No se pudo guardar el archivo.' }, 500);
  }
}
