import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import {
  blockSocialUser,
  createSocialPost,
  deleteSocialPost,
  followSocialUser,
  getMySocialProfile,
  listBlockedProfiles,
  listDirectMessages,
  listDiscoverProfiles,
  listSocialFeed,
  listSocialMatches,
  reportSocialContent,
  saveSocialProfile,
  sendDirectMessage,
  toggleSocialLike,
  unfollowSocialUser,
  unblockSocialUser,
} from '../../_shared/social.ts';
import { requireAuth } from '../../_shared/auth.ts';

async function currentUser(context: PagesContext) {
  const auth = await requireAuth({
    request: context.request,
    env: context.env,
    params: {},
    next: context.next,
  });
  return 'errorResponse' in auth ? { response: auth.errorResponse } : { user: auth.user };
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const auth = await currentUser(context);
  if (auth.response) return auth.response;
  const user = auth.user!;
  const url = new URL(context.request.url);
  const view = url.searchParams.get('view') || 'profile';

  try {
    if (view === 'profile') {
      return jsonResponse({
        ok: true,
        profile: await getMySocialProfile(context.env, user),
        birthDate: user.dob || '',
      });
    }
    if (view === 'discover') {
      return jsonResponse({ ok: true, profiles: await listDiscoverProfiles(context.env, user) });
    }
    if (view === 'matches') {
      return jsonResponse({
        ok: true,
        profiles: await listSocialMatches(context.env, user),
        blocked: await listBlockedProfiles(context.env, user),
      });
    }
    if (view === 'feed') {
      const before = Math.max(0, Number(url.searchParams.get('before') || 0) || 0);
      return jsonResponse({ ok: true, posts: await listSocialFeed(context.env, user, before) });
    }
    if (view === 'messages') {
      const peerId = (url.searchParams.get('peerId') || '').trim();
      const after = Math.max(0, Number(url.searchParams.get('after') || 0) || 0);
      if (!peerId) return jsonResponse({ ok: false, error: 'Falta el destinatario del chat.' }, 400);
      return jsonResponse({
        ok: true,
        messages: await listDirectMessages(context.env, user, peerId, after),
      });
    }
    return jsonResponse({ ok: false, error: 'Vista social no encontrada.' }, 404);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'No se pudo cargar esta sección.' },
      400,
    );
  }
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const auth = await currentUser(context);
  if (auth.response) return auth.response;
  const user = auth.user!;
  const body = await parseJsonBody<Record<string, unknown>>(context.request);
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    if (action === 'save-profile') {
      const result = await saveSocialProfile(context.env, user, body);
      if (result.error) return jsonResponse({ ok: false, error: result.error }, 400);
      return jsonResponse({ ok: true, profile: result.profile });
    }
    if (action === 'follow') {
      const relation = await followSocialUser(context.env, user, String(body.userId || ''));
      return jsonResponse({ ok: true, ...relation });
    }
    if (action === 'unfollow') {
      await unfollowSocialUser(context.env, user, String(body.userId || ''));
      return jsonResponse({ ok: true });
    }
    if (action === 'send-message') {
      const message = await sendDirectMessage(
        context.env,
        user,
        String(body.userId || ''),
        body.text,
      );
      return jsonResponse({ ok: true, message });
    }
    if (action === 'create-post') {
      const post = await createSocialPost(context.env, user, body);
      return jsonResponse({ ok: true, post }, 201);
    }
    if (action === 'toggle-like') {
      const result = await toggleSocialLike(context.env, user, String(body.postId || ''));
      return jsonResponse({ ok: true, ...result });
    }
    if (action === 'delete-post') {
      const result = await deleteSocialPost(context.env, user, String(body.postId || ''));
      if (result.mediaId && typeof context.env.MEDIA_DIR === 'string') {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const mediaPath = path.join(context.env.MEDIA_DIR, `${result.mediaId}`);
        for (const extension of ['jpg', 'png', 'webp', 'gif', 'mp4', 'webm']) {
          await fs.unlink(`${mediaPath}.${extension}`).catch(() => {});
        }
      }
      return jsonResponse({ ok: true });
    }
    if (action === 'block') {
      await blockSocialUser(context.env, user, String(body.userId || ''));
      return jsonResponse({ ok: true });
    }
    if (action === 'unblock') {
      await unblockSocialUser(context.env, user, String(body.userId || ''));
      return jsonResponse({ ok: true });
    }
    if (action === 'report') {
      await reportSocialContent(context.env, user, body);
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: false, error: 'Acción social no reconocida.' }, 400);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'No se pudo completar la acción.' },
      400,
    );
  }
}
