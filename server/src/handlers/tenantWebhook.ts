import { Request, Response, NextFunction } from "express";
import { UpdateWebhookSchema } from "../schemas/tenantWebhook";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { prisma } from "../utils/db";

export async function updateWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = UpdateWebhookSchema.safeParse(req.body);

  if (!result.success) {
    res.status(400).json({ error: result.error.format() });
    return;
  }

  const { webhookUrl } = result.data;
  const apiKeyConfig = res.locals.apiKey as ApiKeyConfig;
  const { tenantId } = apiKeyConfig;

  try {
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { webhookUrl },
    });

    res.status(200).json(tenant);
  } catch (error) {
    next(error);
  }
}
