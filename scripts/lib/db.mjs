import {verifiedDatabaseUrl} from './database-tls.mjs';

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const adapter = new PrismaPg({ connectionString:verifiedDatabaseUrl(connectionString) });

export const prisma = new PrismaClient({ adapter });
