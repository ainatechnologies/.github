import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";

export async function POST(req: NextRequest) {
  let body: { count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1) {
    return NextResponse.json(
      { error: "count must be an integer >= 1" },
      { status: 400 }
    );
  }

  const index = randomInt(0, count);
  return NextResponse.json({ index, drawnAt: new Date().toISOString() });
}
