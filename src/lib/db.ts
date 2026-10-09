import { PrismaClient } from "@prisma/client";

// One shared client in dev (Next.js hot reload would otherwise open many connections).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
