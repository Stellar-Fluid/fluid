import { z } from "zod";

export const UpdateWebhookSchema = z.object({
  webhookUrl: z.string().url().nullable(),
});

export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookSchema>;
