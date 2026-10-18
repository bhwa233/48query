import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/notes/schema.ts",
  out: "./migrations",
});
