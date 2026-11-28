
import './scripts/lib/security-log-bootstrap.mjs';
import "dotenv/config";
import { defineConfig } from "prisma/config";
import {verifiedDatabaseUrl} from './scripts/lib/database-tls.mjs';

const databaseUrl=process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl?verifiedDatabaseUrl(databaseUrl):'',
  },
});
