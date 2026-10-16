import { NextRequest, NextResponse } from "next/server";
import { getOrCreateToken } from "@/lib/auth";

/** 用 token 换 30 天写操作 cookie：/api/auth?token=xxx */
export async function GET(req: NextRequest) {
  const provided = req.nextUrl.searchParams.get("token") ?? "";
  const expected = getOrCreateToken();
  if (provided !== expected) {
    return NextResponse.json({ ok: false, error: "token mismatch" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wl_auth", expected, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
