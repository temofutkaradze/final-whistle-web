
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [schema] = await prisma.$queryRaw<Array<{ready:boolean}>>`
      SELECT to_regclass('public."AuthIdentity"') IS NOT NULL
         AND to_regclass('public."MatchPairingChallenge"') IS NOT NULL
         AND to_regclass('public."MatchTelegramBinding"') IS NOT NULL AS ready
    `;
    if (!schema?.ready) {
      return Response.json({ok:false,database:"schema_incomplete"},{status:503});
    }

    return Response.json({
      ok: true,
      database: "connected",
    });
  } catch {
    console.error("Database health check failed");

    return Response.json(
      {
        ok: false,
        database: "error",
      },
      { status: 500 },
    );
  }
}
