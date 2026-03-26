import StellarSdk from "@stellar/stellar-sdk";
import Decimal from "decimal.js";
import { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Config } from "../config";
import { ApiKeyConfig } from "../middleware/apiKeys";
import { MockPriceOracle } from "../utils/priceOracle";
import { feeBumpHandler } from "./feeBump";

describe("feeBumpHandler - Slippage Protection", () => {
  let mockConfig: Config;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockApiKeyConfig: ApiKeyConfig;

  beforeEach(() => {
    // Mock config
    mockConfig = {
      feePayerAccounts: [
        {
          publicKey: "GTEST1234567890123456789012345678901234567890",
          keypair: StellarSdk.Keypair.random(),
          secretSource: {
            type: "env",
            secret: "SABER1234567890123456789012345678901234567890",
          },
        },
      ],
      signerPool: {} as any, // Mock signer pool
      baseFee: 100,
      feeMultiplier: 2.0,
      networkPassphrase: "Test SDF Network ; September 2015",
      allowedOrigins: ["*"],
      rateLimitWindowMs: 60000,
      rateLimitMax: 5,
      alerting: {} as any, // Mock alerting config
    };

    // Mock API key config
    mockApiKeyConfig = {
      key: "test-key",
      tenantId: "test-tenant",
      name: "Test API Key",
      tier: "pro",
      maxRequests: 100,
      windowMs: 60000,
      dailyQuotaStroops: 1000000,
    };

    // Mock request
    mockReq = {
      body: {},
      headers: {},
      method: "POST",
      url: "/fee-bump",
    };

    // Mock response
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      locals: {
        apiKey: mockApiKeyConfig,
      },
    };

    // Mock next function
    mockNext = vi.fn();

    // Mock tenant store
    vi.doMock("../models/tenantStore", () => ({
      syncTenantFromApiKey: vi.fn().mockReturnValue({
        id: "test-tenant",
        name: "Test Tenant",
        dailyQuotaStroops: 1000000,
        isActive: true,
        createdAt: new Date(),
      }),
    }));

    // Mock transaction ledger
    vi.doMock("../models/transactionLedger", () => ({
      getTenantDailySpendStroops: vi.fn().mockResolvedValue(0),
      recordSponsoredTransaction: vi.fn(),
    }));
  });

  it("should reject transaction when slippage exceeds maxSlippage", async () => {
    // Create a valid Stellar transaction
    const keypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(keypair.publicKey(), "1000000000");

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: mockConfig.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: "GDEST1234567890123456789012345678901234567890",
          asset: StellarSdk.Asset.native(),
          amount: "1000",
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    // Set up price oracle with 5% price increase
    const priceOracle = new MockPriceOracle();
    const originalPrice = new Decimal("0.10"); // $0.10 XLM
    const currentPrice = new Decimal("0.105"); // $0.105 XLM (5% increase)

    priceOracle.setPrice("XLM", originalPrice);
    priceOracle.setPrice("XLM", currentPrice);

    // Mock request with token and maxSlippage
    mockReq.body = {
      xdr: transaction.toXDR(),
      submit: false,
      token: "XLM",
      maxSlippage: 1.0, // 1% max slippage
    };

    await feeBumpHandler(
      mockReq as Request,
      mockRes as Response,
      mockNext,
      mockConfig,
    );

    // Verify that next was called with SLIPPAGE_TOO_HIGH error
    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        code: "SLIPPAGE_TOO_HIGH",
        message: "Slippage too high: try increasing your fee payment",
      }),
    );
  });

  it("should allow transaction when slippage is within maxSlippage", async () => {
    // Create a valid Stellar transaction
    const keypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(keypair.publicKey(), "1000000000");

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: mockConfig.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: "GDEST1234567890123456789012345678901234567890",
          asset: StellarSdk.Asset.native(),
          amount: "1000",
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    // Set up price oracle with 0.5% price increase (within 1% maxSlippage)
    const priceOracle = new MockPriceOracle();
    const originalPrice = new Decimal("0.10"); // $0.10 XLM
    const currentPrice = new Decimal("0.1005"); // $0.1005 XLM (0.5% increase)

    priceOracle.setPrice("XLM", originalPrice);
    priceOracle.setPrice("XLM", currentPrice);

    // Mock request with token and maxSlippage
    mockReq.body = {
      xdr: transaction.toXDR(),
      submit: false,
      token: "XLM",
      maxSlippage: 1.0, // 1% max slippage
    };

    await feeBumpHandler(
      mockReq as Request,
      mockRes as Response,
      mockNext,
      mockConfig,
    );

    // Verify that the transaction was processed successfully
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        fee_payer: expect.any(String),
        xdr: expect.any(String),
      }),
    );
  });

  it("should skip slippage validation when token is not provided", async () => {
    // Create a valid Stellar transaction
    const keypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(keypair.publicKey(), "1000000000");

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: mockConfig.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: "GDEST1234567890123456789012345678901234567890",
          asset: StellarSdk.Asset.native(),
          amount: "1000",
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(keypair);

    // Mock request without token (XLM payment)
    mockReq.body = {
      xdr: transaction.toXDR(),
      submit: false,
      // No token or maxSlippage
    };

    await feeBumpHandler(
      mockReq as Request,
      mockRes as Response,
      mockNext,
      mockConfig,
    );

    // Verify that the transaction was processed successfully
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
        fee_payer: expect.any(String),
        xdr: expect.any(String),
      }),
    );
  });
});
