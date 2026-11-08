/** Run a server action from the client; a thrown transport error reads as null. */
export async function safeRequest<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

export function safeSignOut(signOut: () => Promise<{ ok: boolean }>) {
  return safeRequest(signOut);
}
