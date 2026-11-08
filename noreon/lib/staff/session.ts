import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";

import {staffNoticeReturnPath} from '@/lib/staff-zoe/notice-link';
import { isRealStaffPath, staffPathAllowed } from "./hosts";

/** Refresh the staff auth token on staff requests without touching patient cookies. */
export async function updateStaffSession(request: NextRequest) {
  // Overwrite untrusted headers before the review layout can redirect to sign-in.
  request.headers.delete('x-noreon-staff-notice-path');
  const noticePath=staffNoticeReturnPath(request.nextUrl.pathname);
  if(noticePath)request.headers.set('x-noreon-staff-notice-path',noticePath);
  if (!staffPathAllowed(request.headers.get("host") ?? request.nextUrl.host, request.nextUrl.pathname)) return new NextResponse("Not found", { status: 404 });
  const real = isRealStaffPath(request.nextUrl.pathname);
  const url = real ? process.env.NEXT_PUBLIC_SUPABASE_URL : process.env.NOREON_WORKSPACE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = real ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : process.env.NOREON_WORKSPACE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, anonKey, {
    cookieOptions: { name: real ? "noreon-real-staff-auth" : "noreon-workspace-auth", path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Refresh or verify the staff session before the route renders.
  await supabase.auth.getUser();
  return response;
}
