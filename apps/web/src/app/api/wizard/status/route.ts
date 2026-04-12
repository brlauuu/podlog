import { NextRequest, NextResponse } from "next/server";

const WIZARD_COOKIE = "podlog_wizard_completed";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest) {
  const completed = req.cookies.get(WIZARD_COOKIE)?.value;
  return NextResponse.json({ completed: completed === "true" });
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { completed?: unknown };
    if (typeof body.completed !== "boolean") {
      return NextResponse.json({ error: "completed must be boolean" }, { status: 400 });
    }

    const response = NextResponse.json({ completed: body.completed });
    if (body.completed) {
      response.cookies.set(WIZARD_COOKIE, "true", {
        path: "/",
        maxAge: ONE_YEAR_SECONDS,
        sameSite: "lax",
      });
    } else {
      response.cookies.set(WIZARD_COOKIE, "", {
        path: "/",
        maxAge: 0,
        sameSite: "lax",
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
}
