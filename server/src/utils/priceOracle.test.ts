import { describe, it, expect, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { MockPriceOracle, calculateSlippagePercentage, validateSlippage } from "./priceOracle";

describe("Price Oracle and Slippage Validation", () => {
  let priceOracle: MockPriceOracle;

  beforeEach(() => {
    priceOracle = new MockPriceOracle();
  });

  describe("MockPriceOracle", () => {
    it("should return current price for known token", async () => {
      const price = await priceOracle.getCurrentPrice("XLM");
      expect(price).toBeInstanceOf(Decimal);
      expect(price.toNumber()).toBeGreaterThan(0);
    });

    it("should throw error for unknown token", async () => {
      await expect(priceOracle.getCurrentPrice("UNKNOWN")).rejects.toThrow("Price not available for token: UNKNOWN");
    });

    it("should store price history", async () => {
      const originalPrice = new Decimal("0.10");
      const newPrice = new Decimal("0.11");
      
      priceOracle.setPrice("XLM", originalPrice);
      priceOracle.setPrice("XLM", newPrice);
      
      const currentPrice = await priceOracle.getCurrentPrice("XLM");
      expect(currentPrice.toString()).toBe("0.11");
    });
  });

  describe("calculateSlippagePercentage", () => {
    it("should calculate correct slippage for price increase", () => {
      const originalPrice = new Decimal("0.10");
      const newPrice = new Decimal("0.105"); // 5% increase
      
      const slippage = calculateSlippagePercentage(originalPrice, newPrice);
      expect(slippage.toString()).toBe("5");
    });

    it("should calculate correct slippage for price decrease", () => {
      const originalPrice = new Decimal("0.10");
      const newPrice = new Decimal("0.095"); // 5% decrease
      
      const slippage = calculateSlippagePercentage(originalPrice, newPrice);
      expect(slippage.toString()).toBe("5");
    });

    it("should return zero for same price", () => {
      const price = new Decimal("0.10");
      
      const slippage = calculateSlippagePercentage(price, price);
      expect(slippage.toString()).toBe("0");
    });

    it("should throw error for zero original price", () => {
      const originalPrice = new Decimal("0");
      const newPrice = new Decimal("0.10");
      
      expect(() => calculateSlippagePercentage(originalPrice, newPrice)).toThrow("Original price cannot be zero");
    });
  });

  describe("validateSlippage", () => {
    it("should pass validation when slippage is within limit", () => {
      const originalPrice = new Decimal("0.10");
      const currentPrice = new Decimal("0.102"); // 2% increase
      const maxSlippage = 5; // 5%
      
      const result = validateSlippage(originalPrice, currentPrice, maxSlippage);
      
      expect(result.valid).toBe(true);
      expect(result.actualSlippage.toString()).toBe("2");
    });

    it("should fail validation when slippage exceeds limit", () => {
      const originalPrice = new Decimal("0.10");
      const currentPrice = new Decimal("0.105"); // 5% increase
      const maxSlippage = 1; // 1%
      
      const result = validateSlippage(originalPrice, currentPrice, maxSlippage);
      
      expect(result.valid).toBe(false);
      expect(result.actualSlippage.toString()).toBe("5");
    });

    it("should handle edge case of exact slippage limit", () => {
      const originalPrice = new Decimal("0.10");
      const currentPrice = new Decimal("0.101"); // 1% increase
      const maxSlippage = 1; // 1%
      
      const result = validateSlippage(originalPrice, currentPrice, maxSlippage);
      
      expect(result.valid).toBe(true);
      expect(result.actualSlippage.toString()).toBe("1");
    });
  });

  describe("Integration Test: 5% price move with 1% maxSlippage", () => {
    it("should reject transaction when price moves 5% but maxSlippage is 1%", async () => {
      // Set up scenario: 5% price increase
      const originalPrice = new Decimal("0.10");
      const currentPrice = new Decimal("0.105"); // 5% increase
      const maxSlippage = 1; // 1%
      
      // Validate slippage
      const result = validateSlippage(originalPrice, currentPrice, maxSlippage);
      
      // Should fail validation
      expect(result.valid).toBe(false);
      expect(result.actualSlippage.toString()).toBe("5");
      
      // This simulates the acceptance criteria:
      // "Rejects the request if the dynamic price has moved more than the allowed percentage"
      // 5% > 1% = REJECT
    });
  });
});
