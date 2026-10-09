/** Resolves a Firebase ID token to the caller's uid; null for a missing, malformed, expired or foreign token. */
export interface IdTokenVerifier {
  verify(token: string): Promise<{ readonly uid: string } | null>;
}

/** Firebase Admin verification with the service identity; the module loads lazily so tests never touch it. */
export function createFirebaseVerifier(projectId: string): IdTokenVerifier {
  let auth: Promise<{ verifyIdToken(token: string): Promise<{ uid: string }> }> | null = null;
  const load = () => auth ??= (async () => {
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
    const app = getApps()[0] ?? initializeApp({ projectId });
    return getAuth(app);
  })();
  return {
    async verify(token) {
      try {
        const decoded = await (await load()).verifyIdToken(token);
        return typeof decoded.uid === 'string' && decoded.uid.length > 0 ? { uid: decoded.uid } : null;
      } catch { return null; }
    },
  };
}

/** Test and local-development verifier: a fixed token-to-uid table. */
export function staticVerifier(tokens: Readonly<Record<string, string>>): IdTokenVerifier {
  return { async verify(token) { const uid = tokens[token]; return uid === undefined ? null : { uid }; } };
}
