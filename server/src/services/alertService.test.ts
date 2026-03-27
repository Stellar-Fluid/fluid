import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlertService,
  resolveLowBalanceCheckIntervalMs,
  resolveLowBalanceCooldownMs,
  resolveLowBalanceThresholdXlm,
} from "./alertService";
import type { SlackNotifierLike } from "./slackNotifier";

function createSlackNotifierMock(): SlackNotifierLike {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    isEnabled: vi.fn().mockReturnValue(true),
    notifyFailedTransaction: vi.fn().mockResolvedValue(true),
    notifyLowBalance: vi.fn().mockResolvedValue(true),
    notifyServerError: vi.fn().mockResolvedValue(true),
    notifyServerLifecycle: vi.fn().mockResolvedValue(true),
  };
}

describe("AlertService", () => {
  const payload = {
    accountPublicKey: "GLOWBALANCEEXAMPLE",
    balanceXlm: 0.75,
    checkedAt: new Date("2026-03-27T12:05:00.000Z"),
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Testnet",
    thresholdXlm: 5,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("delegates low-balance alerts to the Slack notifier", async () => {
    const notifier = createSlackNotifierMock();
    const service = new AlertService(
      {
        checkIntervalMs: 60_000,
        cooldownMs: 3_600_000,
      },
      notifier,
    );

    const sent = await service.sendLowBalanceAlert(payload);

    expect(sent).toBe(true);
    expect(notifier.notifyLowBalance).toHaveBeenCalledTimes(1);
  });

  it("suppresses duplicate low-balance alerts inside the one-hour cooldown window", async () => {
    const notifier = createSlackNotifierMock();
    const service = new AlertService(
      {
        checkIntervalMs: 60_000,
        cooldownMs: 60_000,
      },
      notifier,
    );

    expect(await service.sendLowBalanceAlert(payload)).toBe(true);
    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(await service.sendLowBalanceAlert(payload)).toBe(false);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(await service.sendLowBalanceAlert(payload)).toBe(true);
    expect(notifier.notifyLowBalance).toHaveBeenCalledTimes(2);
  });

  it("sends SMTP alerts with the dashboard link in both text and html bodies", async () => {
    const notifier = createSlackNotifierMock();
    notifier.isConfigured = vi.fn().mockReturnValue(false);
    notifier.isEnabled = vi.fn().mockReturnValue(false);

    const sendMail = vi.fn().mockResolvedValue({});
    const service = new AlertService(
      {
        checkIntervalMs: 60_000,
        cooldownMs: 3_600_000,
      },
      notifier,
      {
        dashboardUrl: "https://dashboard.fluid.test/admin/dashboard",
        emailTransport: {
          from: "alerts@fluid.test",
          host: "smtp.fluid.test",
          kind: "smtp",
          port: 587,
          secure: false,
          to: ["ops@fluid.test"],
        },
        loadNodeMailer: () => ({
          createTransport: () => ({
            sendMail,
          }),
        }),
      },
    );

    expect(await service.sendLowBalanceAlert(payload)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const [message] = sendMail.mock.calls[0];
    expect(message.text).toContain(
      "Dashboard: https://dashboard.fluid.test/admin/dashboard",
    );
    expect(message.html).toContain("Open operator dashboard");
  });

  it("sends low-balance alerts through Resend when API credentials are configured", async () => {
    const notifier = createSlackNotifierMock();
    notifier.isConfigured = vi.fn().mockReturnValue(false);
    notifier.isEnabled = vi.fn().mockReturnValue(false);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue("ok"),
    });

    const service = new AlertService(
      {
        checkIntervalMs: 60_000,
        cooldownMs: 3_600_000,
      },
      notifier,
      {
        dashboardUrl: "https://dashboard.fluid.test/admin/dashboard",
        emailTransport: {
          apiKey: "re_test_123",
          apiUrl: "https://api.resend.test/emails",
          from: "alerts@fluid.test",
          kind: "resend",
          to: ["ops@fluid.test"],
        },
        fetchImpl: fetchMock as typeof fetch,
      },
    );

    expect(await service.sendLowBalanceAlert(payload)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.test/emails");
    expect(request.headers.Authorization).toBe("Bearer re_test_123");

    const body = JSON.parse(String(request.body));
    expect(body.text).toContain(
      "Dashboard: https://dashboard.fluid.test/admin/dashboard",
    );
    expect(body.html).toContain("Open operator dashboard");
  });
});

describe("low-balance env resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers LOW_BALANCE_ALERT_XLM over the legacy threshold env name", () => {
    vi.stubEnv("LOW_BALANCE_ALERT_XLM", "12.5");
    vi.stubEnv("FLUID_LOW_BALANCE_THRESHOLD_XLM", "50");

    expect(resolveLowBalanceThresholdXlm(undefined)).toBe(12.5);
  });

  it("defaults the polling interval to five minutes when no override is present", () => {
    expect(resolveLowBalanceCheckIntervalMs(undefined, {} as NodeJS.ProcessEnv)).toBe(
      300_000,
    );
  });

  it("enforces a minimum cooldown of one hour per account", () => {
    vi.stubEnv("LOW_BALANCE_ALERT_COOLDOWN_MS", "60000");

    expect(resolveLowBalanceCooldownMs(undefined)).toBe(3_600_000);
  });
});
