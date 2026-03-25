import { Request, Response, NextFunction } from "express";
import { Config } from "../config";
import { getHealthStatus } from "../services/healthService";

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
