import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const KEY = "wizard_completed";

export async function GET() {
  const { rows } = await pool.query(
    "SELECT value FROM system_state WHERE key = $1",
    [KEY]
  );
  return NextResponse.json({ completed: rows.length > 0 && rows[0].value === "1" });
}

export async function PUT(req: NextRequest) {
  const { completed } = await req.json();

  if (completed) {
    await pool.query(
      "INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [KEY, "1"]
    );
  } else {
    await pool.query("DELETE FROM system_state WHERE key = $1", [KEY]);
  }

  return NextResponse.json({ completed: !!completed });
}
