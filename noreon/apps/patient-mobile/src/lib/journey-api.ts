import { getAuthClient } from "./supabase";
import { verifiedActionClient } from "./action-identity";
import { createJourneyHttp } from "./journey-http";
export function nativeJourneyTransport(userId: string) {
  return createJourneyHttp(userId, async (signal) => {
    const client = getAuthClient();
    if (!client) throw Error("Unavailable");
    return verifiedActionClient(
      userId,
      client.auth,
      (token) => {
        if (signal.aborted || getAuthClient() !== client)
          throw Error("Unavailable");
        return token;
      },
      signal,
    );
  });
}
