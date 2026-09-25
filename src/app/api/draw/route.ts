import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";

/** Pick `pick` unique indices from 0..count-1 using crypto.randomInt (partial Fisher–Yates). */
export async function POST(req: NextRequest) {
  let body: { count?: number; pick?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const count = Number(body.count);
  const pick = Number(body.pick ?? 1);

  if (!Number.isInteger(count) || count < 1) {
    return NextResponse.json(
      { error: "count must be an integer >= 1" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(pick) || pick < 1) {
    return NextResponse.json(
      { error: "pick must be an integer >= 1" },
      { status: 400 }
    );
  }
  if (pick > count) {
    return NextResponse.json(
      { error: "pick cannot exceed eligible entrant count" },
      { status: 400 }
    );
  }

  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = 0; i < pick; i++) {
    const j = randomInt(i, count);
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  const selected = indices.slice(0, pick);
  return NextResponse.json({
    index: selected[0],
    indices: selected,
    drawnAt: new Date().toISOString(),
  });
}
