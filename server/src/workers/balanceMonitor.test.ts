import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceMonitor } from "./balanceMonitor";

describe("BalanceMonitor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses LOW_BALANCE_ALERT_XLM when set and sends an alert below the alias threshold", async () => {
    vi.stubEnv("LOW_BALANCE_ALERT_XLM", "10");

    const alertService = {
      markBalanceRecovered: vi.fn(),
      sendLowBalanceAlert: vi.fn().mockResolvedValue(true),
    };

    const monitor = new BalanceMonitor(
      {
        alerting: {
          checkIntervalMs: 60_000,
          cooldownMs: 3_600_000,
          lowBalanceThresholdXlm: 5,
        },
        feePayerAccounts: [
          {
            keypair: {} as never,
            publicKey: "GTESTBALANCEACCOUNT",
            secretSource: { secret: "secret", type: "env" },
          },
        ],
        horizonUrl: "https://horizon-testnet.stellar.org",
        networkPassphrase: "Testnet",
      } as never,
      alertService as never,
    ) as BalanceMonitor & {
      getNativeBalance: (publicKey: string) => Promise<number>;
    };

    monitor.getNativeBalance = vi.fn().mockResolvedValue(7);

    await monitor.checkBalances();

    expect(alertService.sendLowBalanceAlert).toHaveBeenCalledTimes(1);
    expect(alertService.sendLowBalanceAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        accountPublicKey: "GTESTBALANCEACCOUNT",
        thresholdXlm: 10,
      }),
    );
  });
});
