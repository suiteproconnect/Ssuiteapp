import type { D1Database, PagesEnv } from './cf.ts';
import { updateUser, type StoredUser } from './store.ts';

export interface SocialProfileInput {
  displayName?: unknown;
  gender?: unknown;
  birthDate?: unknown;
  city?: unknown;
  bio?: unknown;
  interests?: unknown;
  avatarMediaId?: unknown;
  discoverable?: unknown;
}

export interface SocialProfile {
  userId: string;
  displayName: string;
  gender: string;
  age: number;
  birthDate?: string;
  city: string;
  bio: string;
  interests: string[];
  avatarUrl: string | null;
  avatarMediaId?: string | null;
  suiteCode?: string;
  discoverable?: boolean;
  isFollowing?: boolean;
  followsYou?: boolean;
  isMatch?: boolean;
  commonInterests?: string[];
}

export interface SocialMediaRecord {
  id: string;
  ownerId: string;
  purpose: 'post' | 'avatar';
  kind: 'image' | 'video';
  contentType: string;
  extension: string;
  size: number;
  fileName: string;
  createdAt: number;
}

const SOCIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS social_profiles (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    interests_json TEXT NOT NULL DEFAULT '[]',
    avatar_media_id TEXT,
    discoverable INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS social_follows (
    follower_id TEXT NOT NULL,
    followed_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followed_id)
  )`,
  `CREATE TABLE IF NOT EXISTS social_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS social_media (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    size INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    post_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS social_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    caption TEXT NOT NULL,
    media_id TEXT,
    content_warning INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS social_likes (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS social_blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  )`,
  `CREATE TABLE IF NOT EXISTS social_reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_social_messages_thread ON social_messages(sender_id, recipient_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_social_messages_recipient ON social_messages(recipient_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_social_follows_followed ON social_follows(followed_id, follower_id)',
  'CREATE INDEX IF NOT EXISTS idx_social_media_owner ON social_media(owner_id, created_at)',
];

const readyDatabases = new WeakSet<object>();

export async function getSocialDb(env: PagesEnv): Promise<D1Database> {
  const db = env.DB;
  if (!db) throw new Error('La base de datos social no está disponible.');
  if (!readyDatabases.has(db as object)) {
    await db.batch(SOCIAL_SCHEMA.map((statement) => db.prepare(statement)));
    readyDatabases.add(db as object);
  }
  return db;
}

function safeJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function ageFromDate(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 0;
  const birth = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== value) return 0;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function normalizeInterests(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const interests = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 32))
    .filter(Boolean);
  return [...new Set(interests)].slice(0, 10);
}

function profileFromRow(row: Record<string, unknown>, includePrivate = false): SocialProfile {
  const birthDate = String(row.birth_date || '');
  const id = String(row.user_id || '');
  const avatarId = typeof row.avatar_media_id === 'string' ? row.avatar_media_id : '';
  return {
    userId: id,
    displayName: String(row.display_name || row.user_name || 'Usuario'),
    gender: String(row.gender || ''),
    age: ageFromDate(birthDate),
    ...(includePrivate ? { birthDate } : {}),
    city: String(row.city || ''),
    bio: String(row.bio || ''),
    interests: safeJsonArray(row.interests_json),
    avatarUrl: avatarId ? `/api/social/media/${encodeURIComponent(avatarId)}` : null,
    ...(includePrivate ? { avatarMediaId: avatarId || null } : {}),
    ...(row.suite_code ? { suiteCode: String(row.suite_code) } : {}),
    ...(includePrivate ? { discoverable: Number(row.discoverable) !== 0 } : {}),
  };
}

export async function getMySocialProfile(
  env: PagesEnv,
  user: StoredUser,
): Promise<SocialProfile | null> {
  const db = await getSocialDb(env);
  const row = await db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.suite_code
       FROM social_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ?`,
    )
    .bind(user.id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  const profile = profileFromRow(row, true);
  if (!profile.birthDate && user.dob) profile.birthDate = user.dob;
  return profile;
}

export async function saveSocialProfile(
  env: PagesEnv,
  user: StoredUser,
  input: SocialProfileInput,
): Promise<{ profile?: SocialProfile; error?: string }> {
  const db = await getSocialDb(env);
  const displayName = String(input.displayName || user.name).trim().replace(/\s+/g, ' ').slice(0, 32);
  const gender = String(input.gender || '').trim();
  const birthDate = String(input.birthDate || user.dob || '').trim();
  const city = String(input.city || '').trim().replace(/\s+/g, ' ').slice(0, 72);
  const bio = String(input.bio || '').trim().slice(0, 280);
  const interests = normalizeInterests(input.interests);
  const avatarMediaId =
    typeof input.avatarMediaId === 'string'
      ? input.avatarMediaId.trim() || null
      : (
          await db
            .prepare('SELECT avatar_media_id FROM social_profiles WHERE user_id = ?')
            .bind(user.id)
            .first<{ avatar_media_id: string | null }>()
        )?.avatar_media_id || null;
  const discoverable = input.discoverable === false ? 0 : 1;

  if (displayName.length < 2) return { error: 'Escribe un nombre de al menos 2 caracteres.' };
  if (!['Hombre', 'No binario', 'Mujer', 'Prefiero no decir'].includes(gender)) {
    return { error: 'Selecciona cómo quieres aparecer en tu perfil.' };
  }
  if (ageFromDate(birthDate) < 18) return { error: 'Esta sección es exclusiva para personas mayores de 18 años.' };

  if (avatarMediaId) {
    const media = await db
      .prepare('SELECT id FROM social_media WHERE id = ? AND owner_id = ? AND purpose = ?')
      .bind(avatarMediaId, user.id, 'avatar')
      .first();
    if (!media) return { error: 'La foto de perfil ya no está disponible. Vuelve a subirla.' };
  }

  const now = Date.now();
  if (user.dob !== birthDate) {
    user.dob = birthDate;
    await updateUser(env, user);
  }
  await db
    .prepare(
      `INSERT INTO social_profiles (
        user_id, display_name, gender, birth_date, city, bio, interests_json,
        avatar_media_id, discoverable, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name,
        gender = excluded.gender,
        birth_date = excluded.birth_date,
        city = excluded.city,
        bio = excluded.bio,
        interests_json = excluded.interests_json,
        avatar_media_id = excluded.avatar_media_id,
        discoverable = excluded.discoverable,
        updated_at = excluded.updated_at`,
    )
    .bind(
      user.id,
      displayName,
      gender,
      birthDate,
      city,
      bio,
      JSON.stringify(interests),
      avatarMediaId,
      discoverable,
      now,
      now,
    )
    .run();

  return { profile: await getMySocialProfile(env, user) || undefined };
}

async function relationshipState(db: D1Database, viewerId: string, otherId: string) {
  const following = await db
    .prepare('SELECT 1 AS yes FROM social_follows WHERE follower_id = ? AND followed_id = ?')
    .bind(viewerId, otherId)
    .first();
  const followsYou = await db
    .prepare('SELECT 1 AS yes FROM social_follows WHERE follower_id = ? AND followed_id = ?')
    .bind(otherId, viewerId)
    .first();
  return {
    isFollowing: Boolean(following),
    followsYou: Boolean(followsYou),
    isMatch: Boolean(following && followsYou),
  };
}

async function isBlocked(db: D1Database, a: string, b: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS yes FROM social_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    )
    .bind(a, b, b, a)
    .first();
  return Boolean(row);
}

export async function listDiscoverProfiles(
  env: PagesEnv,
  viewer: StoredUser,
): Promise<SocialProfile[]> {
  const db = await getSocialDb(env);
  const rows = await db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.suite_code
       FROM social_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id != ? AND p.gender = 'Hombre' AND p.discoverable = 1
         AND NOT EXISTS (
           SELECT 1 FROM social_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id)
              OR (b.blocker_id = p.user_id AND b.blocked_id = ?)
         )
       ORDER BY p.updated_at DESC
       LIMIT 60`,
    )
    .bind(viewer.id, viewer.id, viewer.id)
    .all<Record<string, unknown>>();

  const viewerProfile = await db
    .prepare('SELECT interests_json FROM social_profiles WHERE user_id = ?')
    .bind(viewer.id)
    .first<{ interests_json: string }>();
  const ownInterests = new Set(safeJsonArray(viewerProfile?.interests_json).map((item) => item.toLowerCase()));
  const profiles = await Promise.all(
    rows.results.map(async (row) => {
      const profile = profileFromRow(row);
      const relation = await relationshipState(db, viewer.id, profile.userId);
      const blocked = await isBlocked(db, viewer.id, profile.userId);
      profile.isFollowing = relation.isFollowing;
      profile.followsYou = relation.followsYou;
      profile.isMatch = relation.isMatch;
      profile.commonInterests = profile.interests.filter((item) => ownInterests.has(item.toLowerCase()));
      return { profile, blocked };
    }),
  );
  return profiles
    .filter(({ blocked }) => !blocked)
    .map(({ profile }) => profile)
    .sort((a, b) => (b.commonInterests?.length || 0) - (a.commonInterests?.length || 0));
}

export async function listSocialMatches(env: PagesEnv, viewer: StoredUser): Promise<SocialProfile[]> {
  const db = await getSocialDb(env);
  const rows = await db
    .prepare(
      `SELECT p.*, u.name AS user_name, u.suite_code
       FROM social_follows mine
       JOIN social_follows theirs
         ON theirs.follower_id = mine.followed_id AND theirs.followed_id = mine.follower_id
       JOIN social_profiles p ON p.user_id = mine.followed_id
       JOIN users u ON u.id = p.user_id
       WHERE mine.follower_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM social_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id)
              OR (b.blocker_id = p.user_id AND b.blocked_id = ?)
         )
       ORDER BY mine.created_at DESC
       LIMIT 100`,
    )
    .bind(viewer.id, viewer.id, viewer.id)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => ({ ...profileFromRow(row), isFollowing: true, followsYou: true, isMatch: true }));
}

export async function listBlockedProfiles(env: PagesEnv, viewer: StoredUser): Promise<SocialProfile[]> {
  const db = await getSocialDb(env);
  const rows = await db
    .prepare(
      `SELECT p.*, u.name AS user_name
       FROM social_blocks b
       JOIN social_profiles p ON p.user_id = b.blocked_id
       JOIN users u ON u.id = p.user_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC`,
    )
    .bind(viewer.id)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => profileFromRow(row));
}

export async function listSocialFeed(
  env: PagesEnv,
  viewer: StoredUser,
  before = 0,
): Promise<Array<Record<string, unknown>>> {
  const db = await getSocialDb(env);
  const rows = await db
    .prepare(
      `SELECT p.id, p.user_id, p.caption, p.media_id, p.content_warning, p.created_at,
              sp.display_name, sp.gender, sp.city, sp.avatar_media_id, sp.interests_json,
              u.suite_code, m.kind AS media_kind, m.content_type,
              (SELECT COUNT(*) FROM social_likes l WHERE l.post_id = p.id) AS likes,
              EXISTS(SELECT 1 FROM social_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
       FROM social_posts p
       JOIN social_profiles sp ON sp.user_id = p.user_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN social_media m ON m.id = p.media_id
       WHERE (? = 0 OR p.created_at < ?)
         AND NOT EXISTS (
           SELECT 1 FROM social_blocks b
           WHERE (b.blocker_id = ? AND b.blocked_id = p.user_id)
              OR (b.blocker_id = p.user_id AND b.blocked_id = ?)
         )
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 30`,
    )
    .bind(viewer.id, before, before, viewer.id, viewer.id)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    displayName: String(row.display_name || 'Usuario'),
    gender: String(row.gender || ''),
    city: String(row.city || ''),
    avatarUrl: row.avatar_media_id
      ? `/api/social/media/${encodeURIComponent(String(row.avatar_media_id))}`
      : null,
    suiteCode: String(row.suite_code || ''),
    caption: String(row.caption || ''),
    contentWarning: Number(row.content_warning) === 1,
    createdAt: Number(row.created_at || 0),
    mediaKind: row.media_kind ? String(row.media_kind) : null,
    mediaUrl: row.media_id ? `/api/social/media/${encodeURIComponent(String(row.media_id))}` : null,
    mediaType: row.content_type ? String(row.content_type) : null,
    likes: Number(row.likes || 0),
    liked: Number(row.liked) === 1 || row.liked === true,
  }));
}

export async function followSocialUser(
  env: PagesEnv,
  viewer: StoredUser,
  targetId: string,
): Promise<{ isMatch: boolean; isFollowing: boolean; followsYou: boolean }> {
  const db = await getSocialDb(env);
  if (!targetId || targetId === viewer.id) throw new Error('No puedes seguir tu propio perfil.');
  if (await isBlocked(db, viewer.id, targetId)) throw new Error('No es posible seguir ese perfil.');
  const target = await db
    .prepare('SELECT user_id FROM social_profiles WHERE user_id = ? AND discoverable = 1')
    .bind(targetId)
    .first();
  if (!target) throw new Error('Ese perfil ya no está disponible.');
  await db
    .prepare('INSERT OR IGNORE INTO social_follows (follower_id, followed_id, created_at) VALUES (?, ?, ?)')
    .bind(viewer.id, targetId, Date.now())
    .run();
  return relationshipState(db, viewer.id, targetId);
}

export async function unfollowSocialUser(env: PagesEnv, viewer: StoredUser, targetId: string): Promise<void> {
  const db = await getSocialDb(env);
  await db
    .prepare('DELETE FROM social_follows WHERE follower_id = ? AND followed_id = ?')
    .bind(viewer.id, targetId)
    .run();
}

async function requireMutualFollow(db: D1Database, a: string, b: string): Promise<void> {
  const relation = await relationshipState(db, a, b);
  if (!relation.isMatch || (await isBlocked(db, a, b))) {
    throw new Error('El chat se habilita cuando se siguen mutuamente.');
  }
}

export async function listDirectMessages(
  env: PagesEnv,
  viewer: StoredUser,
  peerId: string,
  afterId = 0,
): Promise<Array<Record<string, unknown>>> {
  const db = await getSocialDb(env);
  await requireMutualFollow(db, viewer.id, peerId);
  const rows = await db
    .prepare(
      `SELECT id, sender_id, recipient_id, text, created_at
       FROM social_messages
       WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
         AND id > ?
       ORDER BY id ASC
       LIMIT 100`,
    )
    .bind(viewer.id, peerId, peerId, viewer.id, afterId)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: Number(row.id),
    senderId: String(row.sender_id),
    recipientId: String(row.recipient_id),
    text: String(row.text),
    createdAt: Number(row.created_at),
  }));
}

export async function sendDirectMessage(
  env: PagesEnv,
  viewer: StoredUser,
  peerId: string,
  rawText: unknown,
): Promise<Record<string, unknown>> {
  const db = await getSocialDb(env);
  await requireMutualFollow(db, viewer.id, peerId);
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 1200) : '';
  if (!text) throw new Error('Escribe un mensaje antes de enviarlo.');
  const result = await db
    .prepare(
      'INSERT INTO social_messages (sender_id, recipient_id, text, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(viewer.id, peerId, text, Date.now())
    .run();
  const id = Number(result.meta?.last_row_id || 0);
  return { id, senderId: viewer.id, recipientId: peerId, text, createdAt: Date.now() };
}

export async function createSocialPost(
  env: PagesEnv,
  viewer: StoredUser,
  input: { caption?: unknown; mediaId?: unknown; contentWarning?: unknown },
): Promise<Record<string, unknown>> {
  const db = await getSocialDb(env);
  const profile = await getMySocialProfile(env, viewer);
  if (!profile || profile.age < 18) throw new Error('Completa primero tu perfil para mayores de 18 años.');
  const caption = typeof input.caption === 'string' ? input.caption.trim().slice(0, 600) : '';
  const mediaId = typeof input.mediaId === 'string' ? input.mediaId.trim() : '';
  if (!caption && !mediaId) throw new Error('Agrega texto, una foto o un video a tu publicación.');
  if (mediaId) {
    const media = await db
      .prepare(
        `SELECT id FROM social_media
         WHERE id = ? AND owner_id = ? AND purpose = 'post' AND post_id IS NULL`,
      )
      .bind(mediaId, viewer.id)
      .first();
    if (!media) throw new Error('El archivo no está disponible. Vuelve a subirlo.');
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await db
    .prepare(
      'INSERT INTO social_posts (id, user_id, caption, media_id, content_warning, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, viewer.id, caption, mediaId || null, input.contentWarning ? 1 : 0, createdAt)
    .run();
  if (mediaId) {
    await db.prepare('UPDATE social_media SET post_id = ? WHERE id = ? AND owner_id = ?').bind(id, mediaId, viewer.id).run();
  }
  return {
    id,
    userId: viewer.id,
    displayName: profile.displayName,
    caption,
    contentWarning: Boolean(input.contentWarning),
    createdAt,
    mediaUrl: mediaId ? `/api/social/media/${encodeURIComponent(mediaId)}` : null,
  };
}

export async function toggleSocialLike(
  env: PagesEnv,
  viewer: StoredUser,
  postId: string,
): Promise<{ liked: boolean; likes: number }> {
  const db = await getSocialDb(env);
  const post = await db.prepare('SELECT id FROM social_posts WHERE id = ?').bind(postId).first();
  if (!post) throw new Error('La publicación ya no está disponible.');
  const existing = await db
    .prepare('SELECT 1 AS yes FROM social_likes WHERE post_id = ? AND user_id = ?')
    .bind(postId, viewer.id)
    .first();
  if (existing) {
    await db.prepare('DELETE FROM social_likes WHERE post_id = ? AND user_id = ?').bind(postId, viewer.id).run();
  } else {
    await db
      .prepare('INSERT OR IGNORE INTO social_likes (post_id, user_id, created_at) VALUES (?, ?, ?)')
      .bind(postId, viewer.id, Date.now())
      .run();
  }
  const count = await db
    .prepare('SELECT COUNT(*) AS total FROM social_likes WHERE post_id = ?')
    .bind(postId)
    .first<{ total: number }>();
  return { liked: !existing, likes: Number(count?.total || 0) };
}

export async function deleteSocialPost(
  env: PagesEnv,
  viewer: StoredUser,
  postId: string,
): Promise<{ mediaId: string | null }> {
  const db = await getSocialDb(env);
  const post = await db
    .prepare('SELECT id, media_id FROM social_posts WHERE id = ? AND user_id = ?')
    .bind(postId, viewer.id)
    .first<Record<string, unknown>>();
  if (!post) throw new Error('No se encontró una publicación propia para eliminar.');
  const mediaId = post.media_id ? String(post.media_id) : null;
  await db.prepare('DELETE FROM social_likes WHERE post_id = ?').bind(postId).run();
  await db.prepare('DELETE FROM social_posts WHERE id = ? AND user_id = ?').bind(postId, viewer.id).run();
  if (mediaId) await db.prepare('DELETE FROM social_media WHERE id = ? AND owner_id = ?').bind(mediaId, viewer.id).run();
  return { mediaId };
}

export async function blockSocialUser(env: PagesEnv, viewer: StoredUser, targetId: string): Promise<void> {
  const db = await getSocialDb(env);
  if (!targetId || targetId === viewer.id) throw new Error('No puedes bloquear tu propio perfil.');
  await db
    .prepare('INSERT OR IGNORE INTO social_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .bind(viewer.id, targetId, Date.now())
    .run();
  await db
    .prepare(
      `DELETE FROM social_follows
       WHERE (follower_id = ? AND followed_id = ?) OR (follower_id = ? AND followed_id = ?)`,
    )
    .bind(viewer.id, targetId, targetId, viewer.id)
    .run();
}

export async function unblockSocialUser(env: PagesEnv, viewer: StoredUser, targetId: string): Promise<void> {
  const db = await getSocialDb(env);
  await db
    .prepare('DELETE FROM social_blocks WHERE blocker_id = ? AND blocked_id = ?')
    .bind(viewer.id, targetId)
    .run();
}

export async function reportSocialContent(
  env: PagesEnv,
  viewer: StoredUser,
  input: { targetType?: unknown; targetId?: unknown; reason?: unknown; details?: unknown },
): Promise<void> {
  const db = await getSocialDb(env);
  const targetType = input.targetType === 'post' ? 'post' : input.targetType === 'user' ? 'user' : '';
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim().slice(0, 80) : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const allowedReasons = new Set(['acoso', 'suplantacion', 'contenido-no-consensuado', 'menor-de-edad', 'spam', 'otro']);
  if (!targetType || !targetId || !allowedReasons.has(reason)) {
    throw new Error('Selecciona un motivo válido para el reporte.');
  }
  await db
    .prepare(
      'INSERT INTO social_reports (id, reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      crypto.randomUUID(),
      viewer.id,
      targetType,
      targetId,
      reason,
      String(input.details || '').trim().slice(0, 500),
      Date.now(),
    )
    .run();
}

export async function createSocialMediaRecord(
  env: PagesEnv,
  record: Omit<SocialMediaRecord, 'createdAt'>,
): Promise<SocialMediaRecord> {
  const db = await getSocialDb(env);
  const createdAt = Date.now();
  await db
    .prepare(
      `INSERT INTO social_media (id, owner_id, purpose, kind, content_type, extension, size, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.ownerId,
      record.purpose,
      record.kind,
      record.contentType,
      record.extension,
      record.size,
      record.fileName,
      createdAt,
    )
    .run();
  return { ...record, createdAt };
}

export async function getSocialMediaRecord(env: PagesEnv, id: string): Promise<SocialMediaRecord | null> {
  const db = await getSocialDb(env);
  const row = await db
    .prepare(
      `SELECT id, owner_id, purpose, kind, content_type, extension, size, file_name, created_at
       FROM social_media WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    purpose: row.purpose === 'avatar' ? 'avatar' : 'post',
    kind: row.kind === 'video' ? 'video' : 'image',
    contentType: String(row.content_type),
    extension: String(row.extension),
    size: Number(row.size),
    fileName: String(row.file_name),
    createdAt: Number(row.created_at),
  };
}

export async function deleteSocialMediaRecord(env: PagesEnv, id: string, ownerId: string): Promise<void> {
  const db = await getSocialDb(env);
  await db.prepare('DELETE FROM social_media WHERE id = ? AND owner_id = ?').bind(id, ownerId).run();
}
