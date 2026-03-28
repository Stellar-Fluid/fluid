import { Request, Response, NextFunction } from "express";
import { Config } from "../config";
import { getHealthStatus } from "../services/healthService";

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Service health check
 *     description: >
 *       Returns the overall health of the Fluid server, including Horizon
 *       connectivity status and per-fee-payer account balances.
 *       No authentication required.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Server is healthy or degraded (low-balance warning).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             examples:
 *               healthy:
 *                 summary: All systems nominal
 *                 value:
 *                   status: healthy
 *                   version: "0.1.0"
 *                   network: "Test SDF Network ; September 2015"
 *                   timestamp: "2026-03-28T12:00:00.000Z"
 *                   checks:
 *                     api: ok
 *                     horizon:
 *                       status: healthy
 *                       url: "https://horizon-testnet.stellar.org"
 *                     feePayers:
 *                       - publicKey: "GABC...XYZ"
 *                         status: healthy
 *                         balance: 100.5
 *       503:
 *         description: Server is unhealthy (Horizon unreachable or fee-payer critically low).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */

export async function healthHandler(
  req: Request,
  res: Response,
  next: NextFunction,
  config: Config,
): Promise<void> {
  try {
    const health = await getHealthStatus(config);

    const statusCode =
      health.status === "unhealthy"
        ? 503
        : health.status === "degraded"
          ? 200
          : 200;

    res.status(statusCode).json(health);
  } catch (error) {
    next(error);
  }
}
