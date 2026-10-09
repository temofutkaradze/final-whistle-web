import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Open http://localhost:3000/api/health to check that the database connection works.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, database: "connected" });
  } catch (e) {
    return Response.json(
      { ok: false, database: "error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
