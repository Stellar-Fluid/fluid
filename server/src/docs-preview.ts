/**
 * Standalone Swagger UI preview server.
 * Run with: PORT=3001 npx ts-node --transpile-only src/docs-preview.ts
 * Does NOT require the native signer addon or a database connection.
 */
import "dotenv/config";
import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger";

const app = express();

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/docs.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`Swagger UI available at http://localhost:${PORT}/docs`);
});
