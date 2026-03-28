import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Fluid Fee Sponsorship API",
      version: "0.1.0",
      description:
        "Stellar fee-bump sponsorship service. Wraps inner transactions with a fee-bump envelope so end-users pay zero network fees.",
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT ?? 3000}`,
        description: "Local development server",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description:
            "Tenant API key issued by the Fluid admin dashboard. Required for all fee-bump endpoints.",
        },
      },
      schemas: {
        HealthResponse: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["healthy", "degraded", "unhealthy"],
              example: "healthy",
            },
            version: { type: "string", example: "0.1.0" },
            network: {
              type: "string",
              example: "Test SDF Network ; September 2015",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              example: "2026-03-28T12:00:00.000Z",
            },
            checks: {
              type: "object",
              properties: {
                api: { type: "string", example: "ok" },
                horizon: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["healthy", "unhealthy", "not_configured"],
                    },
                    url: { type: "string" },
                    error: { type: "string" },
                  },
                },
                feePayers: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      publicKey: { type: "string" },
                      status: {
                        type: "string",
                        enum: [
                          "healthy",
                          "warning",
                          "critical",
                          "error",
                          "skipped",
                        ],
                      },
                      balance: { type: "number", nullable: true },
                      warning: { type: "string" },
                      error: { type: "string" },
                      note: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
        FeeBumpRequest: {
          type: "object",
          required: ["xdr"],
          properties: {
            xdr: {
              type: "string",
              description:
                "Base64-encoded XDR of a signed Stellar inner transaction.",
              example:
                "AAAAAgAAAAB... (base64 XDR)",
            },
            submit: {
              type: "boolean",
              description:
                "If true, the fee-bumped transaction is submitted to Horizon immediately. Defaults to false (returns XDR only).",
              example: false,
            },
            token: {
              type: "string",
              description:
                "Optional asset identifier (`CODE` or `CODE:ISSUER`) for whitelist enforcement.",
              example: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            },
            maxSlippage: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description:
                "Maximum acceptable price slippage (%) for token-based fee payment. Requires `token`.",
              example: 1.5,
            },
          },
        },
        FeeBumpResponse: {
          type: "object",
          properties: {
            xdr: {
              type: "string",
              description: "Base64-encoded XDR of the fee-bump transaction.",
            },
            status: {
              type: "string",
              enum: ["ready", "submitted"],
              description:
                "`ready` — XDR returned for client-side submission. `submitted` — transaction was submitted to Horizon by the server.",
            },
            hash: {
              type: "string",
              description:
                "Transaction hash (only present when `status` is `submitted`).",
            },
            fee_payer: {
              type: "string",
              description:
                "Stellar public key of the fee-payer account used to wrap the transaction.",
            },
          },
        },
        FeeBumpBatchRequest: {
          type: "object",
          required: ["xdrs"],
          properties: {
            xdrs: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              description: "Array of base64-encoded signed inner transaction XDRs.",
              example: ["AAAAAgAAAAB...", "AAAAAgAAAAC..."],
            },
            submit: {
              type: "boolean",
              description: "Submit all transactions to Horizon. Defaults to false.",
              example: false,
            },
            token: {
              type: "string",
              description: "Asset identifier for whitelist enforcement (applied to all XDRs).",
            },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string", example: "Validation failed: xdr is required" },
            code: {
              type: "string",
              example: "INVALID_XDR",
              description: "Machine-readable error code.",
            },
          },
        },
      },
    },
  },
  // swagger-jsdoc will scan these files for @openapi / @swagger JSDoc blocks
  apis: [`${__dirname}/index.ts`, `${__dirname}/handlers/*.ts`],
};

export const swaggerSpec = swaggerJsdoc(options);
