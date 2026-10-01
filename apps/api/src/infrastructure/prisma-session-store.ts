import session from 'express-session';

import type { PrismaClient } from '../generated/prisma/client.js';

export class PrismaSessionStore extends session.Store {
  public constructor(private readonly prisma: PrismaClient) {
    super();
  }

  public get(
    sid: string,
    callback: (error: unknown, sessionData?: session.SessionData | null) => void,
  ): void {
    void this.prisma.session
      .findFirst({
        where: {
          id: sid,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      })
      .then((record) => {
        if (!record) {
          callback(null, null);
          return;
        }

        callback(null, JSON.parse(record.dataJson) as session.SessionData);
      })
      .catch((error: unknown) => callback(error));
  }

  public set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (error?: unknown) => void,
  ): void {
    const userId = sessionData.userId;

    void this.prisma.session
      .upsert({
        where: { id: sid },
        create: {
          id: sid,
          userId: userId ?? null,
          dataJson: JSON.stringify(sessionData),
          expiresAt: resolveSessionExpiry(sessionData),
        },
        update: {
          dataJson: JSON.stringify(sessionData),
          expiresAt: resolveSessionExpiry(sessionData),
          revokedAt: null,
        },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  public destroy(sid: string, callback?: (error?: unknown) => void): void {
    void this.prisma.session
      .updateMany({
        where: { id: sid, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .then(() => callback?.())
      .catch((error: unknown) => callback?.(error));
  }

  public override touch(
    sid: string,
    sessionData: session.SessionData,
    callback?: () => void,
  ): void {
    void this.prisma.session
      .updateMany({
        where: { id: sid, revokedAt: null },
        data: { expiresAt: resolveSessionExpiry(sessionData) },
      })
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}

function resolveSessionExpiry(sessionData: session.SessionData): Date {
  if (sessionData.cookie.expires instanceof Date) {
    return sessionData.cookie.expires;
  }

  return new Date(Date.now() + (sessionData.cookie.maxAge ?? 8 * 60 * 60 * 1000));
}
