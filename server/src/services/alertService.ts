import type { AlertEmailConfig, AlertingConfig, Config } from "../config";
import { SlackNotifier, type SlackNotifierLike } from "./slackNotifier";
import type { FcmNotifierLike } from "./fcmNotifier";
import { TwilioNotifier, type TwilioNotifierLike } from "./twilioNotifier";
import { createNotification } from "./notificationService";

type NodeMailerModule = {
  createTransport: (config: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }) => {
    sendMail: (message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }) => Promise<unknown>;
  };
};

interface SmtpTransportConfig extends AlertEmailConfig {
  dashboardUrl?: string;
  kind: "smtp";
}

interface ResendTransportConfig {
  apiKey: string;
  apiUrl: string;
  dashboardUrl?: string;
  from: string;
  kind: "resend";
  to: string[];
}

type EmailTransportConfig = SmtpTransportConfig | ResendTransportConfig;

export interface LowBalanceAlertPayload {
  accountPublicKey: string;
  balanceXlm: number;
  thresholdXlm: number;
  networkPassphrase: string;
  horizonUrl?: string;
  checkedAt: Date;
}

export interface AlertServiceOptions {
  emailTransport?: EmailTransportConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  dashboardUrl?: string;
  loadNodeMailer?: () => NodeMailerModule;
  fcmNotifier?: FcmNotifierLike;
  twilioNotifier?: TwilioNotifierLike;
}

interface AlertState {
  currentlyLow: boolean;
  lastAlertAt?: number;
}

const DEFAULT_LOW_BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_LOW_BALANCE_COOLDOWN_MS = 60 * 60 * 1000;
const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";

function parseCommaSeparatedList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveDashboardUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit =
    env.FLUID_ALERT_DASHBOARD_URL?.trim() ||
    env.DASHBOARD_URL?.trim() ||
    undefined;

  if (explicit) {
    return explicit;
  }

  const firstAllowedOrigin = parseCommaSeparatedList(env.FLUID_ALLOWED_ORIGINS)[0];
  if (!firstAllowedOrigin) {
    return undefined;
  }

  return `${firstAllowedOrigin.replace(/\/$/, "")}/admin/dashboard`;
}

function resolveEmailTransportConfig(
  emailConfig: AlertEmailConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): EmailTransportConfig | undefined {
  const dashboardUrl = resolveDashboardUrl(env);
  const resendApiKey = env.RESEND_API_KEY?.trim();
  const resendFrom =
    env.RESEND_EMAIL_FROM?.trim() ||
    env.FLUID_ALERT_EMAIL_FROM?.trim() ||
    undefined;
  const resendTo = parseCommaSeparatedList(
    env.RESEND_EMAIL_TO || env.FLUID_ALERT_EMAIL_TO,
  );

  if (resendApiKey && resendFrom && resendTo.length > 0) {
    return {
      apiKey: resendApiKey,
      apiUrl: env.RESEND_API_URL?.trim() || DEFAULT_RESEND_API_URL,
      dashboardUrl,
      from: resendFrom,
      kind: "resend",
      to: resendTo,
    };
  }

  if (emailConfig) {
    return {
      ...emailConfig,
      dashboardUrl,
      kind: "smtp",
    };
  }

  const host = env.FLUID_ALERT_SMTP_HOST?.trim();
  const from = env.FLUID_ALERT_EMAIL_FROM?.trim();
  const to = parseCommaSeparatedList(env.FLUID_ALERT_EMAIL_TO);

  if (!host || !from || to.length === 0) {
    return undefined;
  }

  return {
    dashboardUrl,
    from,
    host,
    kind: "smtp",
    pass: env.FLUID_ALERT_SMTP_PASS?.trim() || undefined,
    port: parsePositiveInt(env.FLUID_ALERT_SMTP_PORT) ?? 587,
    secure: env.FLUID_ALERT_SMTP_SECURE === "true",
    to,
    user: env.FLUID_ALERT_SMTP_USER?.trim() || undefined,
  };
}

export function resolveLowBalanceThresholdXlm(
  fallback: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  return (
    parseOptionalNumber(env.LOW_BALANCE_ALERT_XLM) ??
    fallback ??
    parseOptionalNumber(env.FLUID_LOW_BALANCE_THRESHOLD_XLM)
  );
}

export function resolveLowBalanceCheckIntervalMs(
  fallback: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return (
    parsePositiveInt(env.LOW_BALANCE_ALERT_CHECK_INTERVAL_MS) ??
    parsePositiveInt(env.FLUID_LOW_BALANCE_CHECK_INTERVAL_MS) ??
    fallback ??
    DEFAULT_LOW_BALANCE_CHECK_INTERVAL_MS
  );
}

export function resolveLowBalanceCooldownMs(
  fallback: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const configured =
    parsePositiveInt(env.LOW_BALANCE_ALERT_COOLDOWN_MS) ??
    parsePositiveInt(env.FLUID_LOW_BALANCE_ALERT_COOLDOWN_MS) ??
    fallback ??
    MIN_LOW_BALANCE_COOLDOWN_MS;

  return Math.max(configured, MIN_LOW_BALANCE_COOLDOWN_MS);
}

export class AlertService {
  private readonly cooldownMs: number;
  private readonly dashboardUrl?: string;
  private readonly emailTransport?: EmailTransportConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly loadNodeMailerModule: () => NodeMailerModule;
  private readonly now: () => number;
  private readonly state = new Map<string, AlertState>();
  private readonly fcmNotifier?: FcmNotifierLike;
  private readonly twilioNotifier?: TwilioNotifierLike;

  constructor(
    private readonly config: AlertingConfig,
    private readonly slackNotifier: SlackNotifierLike = new SlackNotifier({
      webhookUrl: config.slackWebhookUrl,
    }),
    options: AlertServiceOptions = {},
  ) {
    this.cooldownMs = resolveLowBalanceCooldownMs(config.cooldownMs);
    this.dashboardUrl = options.dashboardUrl ?? resolveDashboardUrl();
    this.emailTransport =
      options.emailTransport ?? resolveEmailTransportConfig(config.email);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.loadNodeMailerModule =
      options.loadNodeMailer ?? this.loadNodeMailer.bind(this);
    this.now = options.now ?? (() => Date.now());
    this.fcmNotifier = options.fcmNotifier;
    this.twilioNotifier =
      options.twilioNotifier ??
      (config.twilio
        ? new TwilioNotifier({
            ...config.twilio,
            criticalThresholdXlm: config.criticalBalanceThresholdXlm,
          })
        : undefined);
  }

  isEnabled(): boolean {
    return (
      Boolean(this.emailTransport) ||
      this.slackNotifier.isConfigured() ||
      Boolean(this.fcmNotifier?.isConfigured()) ||
      Boolean(this.twilioNotifier?.isConfigured())
    );
  }

  async sendLowBalanceAlert(payload: LowBalanceAlertPayload): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const alertState = this.state.get(payload.accountPublicKey) ?? {
      currentlyLow: false,
    };
    const now = this.now();
    const shouldSend =
      !alertState.currentlyLow ||
      !alertState.lastAlertAt ||
      now - alertState.lastAlertAt >= this.cooldownMs;

    this.state.set(payload.accountPublicKey, {
      currentlyLow: true,
      lastAlertAt: shouldSend ? now : alertState.lastAlertAt,
    });

    if (!shouldSend) {
      return false;
    }

    await this.notifyAdmins(payload);
    return true;
  }

  markBalanceRecovered(accountPublicKey: string): void {
    const existing = this.state.get(accountPublicKey);
    if (!existing) {
      return;
    }

    this.state.set(accountPublicKey, {
      currentlyLow: false,
      lastAlertAt: existing.lastAlertAt,
    });
  }

  async sendTestAlert(appConfig: Config): Promise<void> {
    const firstAccount = appConfig.feePayerAccounts[0];
    const thresholdXlm = resolveLowBalanceThresholdXlm(
      appConfig.alerting.lowBalanceThresholdXlm,
    ) ?? 1;

    await this.notifyAdmins({
      accountPublicKey: firstAccount?.publicKey ?? "GTESTALERTPLACEHOLDER",
      balanceXlm: Math.max(0, thresholdXlm - 0.01),
      thresholdXlm,
      networkPassphrase: appConfig.networkPassphrase,
      horizonUrl: appConfig.horizonUrl,
      checkedAt: new Date(),
    });
  }

  private async notifyAdmins(payload: LowBalanceAlertPayload): Promise<void> {
    const tasks: Array<Promise<void>> = [];

    if (this.slackNotifier.isEnabled("low_balance")) {
      tasks.push(
        this.slackNotifier.notifyLowBalance(payload).then((sent) => {
          if (!sent) {
            throw new Error("Slack low-balance alert could not be delivered.");
          }
        }),
      );
    }

    if (this.emailTransport) {
      tasks.push(this.sendEmailAlert(payload, this.emailTransport));
    }

    if (this.fcmNotifier?.isConfigured()) {
      tasks.push(
        this.fcmNotifier
          .notifyLowBalance({
            accountPublicKey: payload.accountPublicKey,
            balanceXlm: payload.balanceXlm,
            thresholdXlm: payload.thresholdXlm,
          })
          .then(() => undefined),
      );
    }

    if (this.twilioNotifier?.isEnabled("low_balance")) {
      tasks.push(
        this.twilioNotifier
          .notifyLowBalance({
            accountPublicKey: payload.accountPublicKey,
            balanceXlm: payload.balanceXlm,
            thresholdXlm: payload.thresholdXlm,
            criticalThresholdXlm:
              this.config.criticalBalanceThresholdXlm ??
              payload.thresholdXlm,
          })
          .then(() => undefined),
      );
    }

    if (tasks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(tasks);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failures.length === results.length) {
      throw new Error(
        `All alert transports failed: ${failures.map((item) => item.reason).join("; ")}`,
      );
    }

    failures.forEach((failure) => {
      console.error("[AlertService] Alert transport failed:", failure.reason);
    });

    // Persist the alert as an AdminNotification for the in-dashboard bell.
    // Fire-and-forget: notification failure must not block alert delivery.
    createNotification({
      type: "low_balance",
      title: `Low fee payer balance: ${payload.balanceXlm.toFixed(2)} XLM`,
      message: `Account ${payload.accountPublicKey.slice(0, 8)}… dropped below the ${payload.thresholdXlm.toFixed(2)} XLM threshold.`,
      metadata: {
        accountPublicKey: payload.accountPublicKey,
        balanceXlm: payload.balanceXlm,
        thresholdXlm: payload.thresholdXlm,
        networkPassphrase: payload.networkPassphrase,
        horizonUrl: payload.horizonUrl,
        checkedAt: payload.checkedAt.toISOString(),
      },
    }).catch((err) =>
      console.error("[AlertService] Failed to persist dashboard notification:", err)
    );
  }

  private async sendEmailAlert(
    payload: LowBalanceAlertPayload,
    transportConfig: EmailTransportConfig,
  ): Promise<void> {
    const subject = `[Fluid] Low fee payer balance: ${payload.balanceXlm.toFixed(2)} XLM`;
    const text = this.buildPlainTextMessage(payload);
    const html = this.buildHtmlMessage(payload);

    if (transportConfig.kind === "resend") {
      const response = await this.fetchImpl(transportConfig.apiUrl, {
        body: JSON.stringify({
          from: transportConfig.from,
          html,
          subject,
          text,
          to: transportConfig.to,
        }),
        headers: {
          Authorization: `Bearer ${transportConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(
          `Resend email alert failed: ${response.status} ${await response.text()}`,
        );
      }

      return;
    }

    const nodemailer = this.loadNodeMailerModule();
    const transport = nodemailer.createTransport({
      auth:
        transportConfig.user && transportConfig.pass
          ? {
              pass: transportConfig.pass,
              user: transportConfig.user,
            }
          : undefined,
      host: transportConfig.host,
      port: transportConfig.port,
      secure: transportConfig.secure,
    });

    await transport.sendMail({
      from: transportConfig.from,
      html,
      subject,
      text,
      to: transportConfig.to.join(", "),
    });
  }

  private loadNodeMailer(): NodeMailerModule {
    try {
      return require("nodemailer") as NodeMailerModule;
    } catch (error) {
      throw new Error(
        "Email alerting requires the 'nodemailer' package to be installed.",
      );
    }
  }

  private buildPlainTextMessage(payload: LowBalanceAlertPayload): string {
    const lines = [
      "Fluid low balance alert",
      "",
      `Fee payer: ${payload.accountPublicKey}`,
      `Current balance: ${payload.balanceXlm.toFixed(7)} XLM`,
      `Threshold: ${payload.thresholdXlm.toFixed(7)} XLM`,
      `Network: ${payload.networkPassphrase}`,
      `Checked at: ${payload.checkedAt.toISOString()}`,
    ];

    if (payload.horizonUrl) {
      lines.push(`Horizon: ${payload.horizonUrl}`);
    }

    if (this.dashboardUrl) {
      lines.push(`Dashboard: ${this.dashboardUrl}`);
    }

    lines.push("", "Top up the fee payer account before sponsorship stops.");
    return lines.join("\n");
  }

  private buildHtmlMessage(payload: LowBalanceAlertPayload): string {
    const horizonLine = payload.horizonUrl
      ? `<p><strong>Horizon:</strong> ${escapeHtml(payload.horizonUrl)}</p>`
      : "";
    const dashboardLine = this.dashboardUrl
      ? `<p><a href="${escapeHtml(this.dashboardUrl)}">Open operator dashboard</a></p>`
      : "";

    return [
      "<h2>Fluid low balance alert</h2>",
      `<p><strong>Fee payer:</strong> ${escapeHtml(payload.accountPublicKey)}</p>`,
      `<p><strong>Current balance:</strong> ${payload.balanceXlm.toFixed(7)} XLM</p>`,
      `<p><strong>Threshold:</strong> ${payload.thresholdXlm.toFixed(7)} XLM</p>`,
      `<p><strong>Network:</strong> ${escapeHtml(payload.networkPassphrase)}</p>`,
      `<p><strong>Checked at:</strong> ${escapeHtml(payload.checkedAt.toISOString())}</p>`,
      horizonLine,
      dashboardLine,
      "<p>Top up the fee payer account before sponsorship stops.</p>",
    ].join("");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
