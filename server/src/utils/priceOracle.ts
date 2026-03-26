import Decimal from "decimal.js";

export interface PriceOracle {
  getCurrentPrice(token: string): Promise<Decimal>;
  getHistoricalPrice(token: string, timestamp: number): Promise<Decimal>;
}

export interface PriceSnapshot {
  token: string;
  price: Decimal;
  timestamp: number;
}

export class MockPriceOracle implements PriceOracle {
  private prices: Map<string, Decimal> = new Map();
  private priceHistory: Map<string, PriceSnapshot[]> = new Map();

  constructor() {
    // Initialize with some mock prices (XLM in USD)
    this.prices.set("XLM", new Decimal("0.10"));
    this.prices.set("USDC", new Decimal("1.00"));
    this.prices.set("EURT", new Decimal("1.08"));
  }

  async getCurrentPrice(token: string): Promise<Decimal> {
    const price = this.prices.get(token.toUpperCase());
    if (!price) {
      throw new Error(`Price not available for token: ${token}`);
    }
    return price;
  }

  async getHistoricalPrice(token: string, timestamp: number): Promise<Decimal> {
    const history = this.priceHistory.get(token.toUpperCase()) || [];
    const snapshot = history.find(s => Math.abs(s.timestamp - timestamp) < 60000); // Within 1 minute
    
    if (snapshot) {
      return snapshot.price;
    }

    // If no historical price found, return current price for testing
    return this.getCurrentPrice(token);
  }

  // Helper method for testing - simulate price movement
  setPrice(token: string, price: Decimal): void {
    const upperToken = token.toUpperCase();
    const oldPrice = this.prices.get(upperToken);
    this.prices.set(upperToken, price);
    
    // Store in history
    if (!this.priceHistory.has(upperToken)) {
      this.priceHistory.set(upperToken, []);
    }
    
    const history = this.priceHistory.get(upperToken)!;
    history.push({
      token: upperToken,
      price: oldPrice || price,
      timestamp: Date.now() - 120000, // 2 minutes ago
    });
    
    // Keep only last 10 entries
    if (history.length > 10) {
      history.shift();
    }
  }
}

export function calculateSlippagePercentage(
  originalPrice: Decimal,
  currentPrice: Decimal
): Decimal {
  if (originalPrice.isZero()) {
    throw new Error("Original price cannot be zero");
  }

  const priceChange = currentPrice.minus(originalPrice);
  return priceChange.div(originalPrice).abs().times(100);
}

export function validateSlippage(
  originalPrice: Decimal,
  currentPrice: Decimal,
  maxSlippagePercent: number
): { valid: boolean; actualSlippage: Decimal } {
  const actualSlippage = calculateSlippagePercentage(originalPrice, currentPrice);
  const maxSlippage = new Decimal(maxSlippagePercent);
  
  return {
    valid: actualSlippage.lte(maxSlippage),
    actualSlippage
  };
}
