
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json({
      ok: true,
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed", error);

    return Response.json(
      {
        ok: false,
        database: "error",
      },
      { status: 500 },
    );
  }
}
