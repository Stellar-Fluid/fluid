import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();
const connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export const webhookQueue = new Queue("webhook-delivery", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 60000, // 1 minute initial delay
    },
    removeOnComplete: true,
  },
});

interface WebhookJobData {
  deliveryId: string;
}

export class WebhookService {
  static async queueWebhook(tenantId: string, url: string, payload: any) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        tenantId,
        url,
        payload,
        status: "pending",
      },
    });

    await webhookQueue.add("deliver", {
      deliveryId: delivery.id,
    });

    return delivery;
  }
}

// Worker logic
export const startWebhookWorker = () => {
  const worker = new Worker<WebhookJobData>(
    "webhook-delivery",
    async (job: Job<WebhookJobData>) => {
      const { deliveryId } = job.data;
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: deliveryId },
      });

      if (!delivery) return;

      try {
        console.log(`[Webhook] Attempting delivery ${deliveryId} (Attempt ${job.attemptsMade + 1}) to ${delivery.url}`);
        
        await axios.post(delivery.url, delivery.payload, {
          timeout: 5000,
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-ID": deliveryId,
          },
        });

        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: "success",
            retryCount: job.attemptsMade,
          },
        });

        console.log(`[Webhook] Delivery ${deliveryId} succeeded`);
      } catch (error: any) {
        const errorMessage = error.response?.data || error.message;
        console.error(`[Webhook] Delivery ${deliveryId} failed: ${errorMessage}`);

        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: "failed",
            retryCount: job.attemptsMade + 1,
            lastError: errorMessage.toString().substring(0, 500),
            nextAttempt: new Date(Date.now() + (job.opts.backoff as any).delay * Math.pow(2, job.attemptsMade)),
          },
        });

        throw error; // Let BullMQ handle the retry
      }
    },
    { connection }
  );

  worker.on("failed", (job, err) => {
    if (job && job.attemptsMade >= 5) {
      console.error(`[Webhook] Delivery ${job.id} failed permanently after 5 attempts`);
    }
  });

  return worker;
};
