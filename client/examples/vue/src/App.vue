<script setup lang="ts">
import { ref, onMounted } from "vue";
import StellarSdk from "@stellar/stellar-sdk";
import { FluidClient } from "fluid-client";
import { useFluid } from "fluid-client/vue";

// Initialize Fluid client
const client = new FluidClient({
  serverUrl: "http://localhost:3000",
  networkPassphrase: StellarSdk.Networks.TESTNET,
  horizonUrl: "https://horizon-testnet.stellar.org",
});

// Use the Fluid composable
const { requestFeeBump, isLoading, error, result } = useFluid(client);

// Local state for the example
const transactionXdr = ref("");
const statusMessage = ref("");

// Create a sample transaction on mount
onMounted(async () => {
  try {
    // Generate a random keypair for demo purposes
    const userKeypair = StellarSdk.Keypair.random();
    console.log("User wallet:", userKeypair.publicKey());

    // Fund the wallet (only on testnet)
    statusMessage.value = "Funding wallet...";
    await fetch(
      `https://friendbot.stellar.org?addr=${userKeypair.publicKey()}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Load account
    const server = new StellarSdk.Horizon.Server(
      "https://horizon-testnet.stellar.org",
    );
    const account = await server.loadAccount(userKeypair.publicKey());

    // Build a sample transaction
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(180)
      .build();

    // Sign transaction
    transaction.sign(userKeypair);

    // Store the XDR
    transactionXdr.value = transaction.toXDR();
    statusMessage.value = "Transaction created and signed!";
  } catch (err) {
    statusMessage.value = `Error creating transaction: ${err instanceof Error ? err.message : "Unknown error"}`;
    console.error("Error:", err);
  }
});

// Request fee bump
async function handleRequestFeeBump() {
  if (!transactionXdr.value) {
    statusMessage.value = "No transaction XDR available";
    return;
  }

  try {
    statusMessage.value = "Requesting fee bump...";
    await requestFeeBump(transactionXdr.value, false);
    statusMessage.value = "Fee bump requested successfully!";
  } catch (err) {
    statusMessage.value = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
</script>

<template>
  <div class="container">
    <h1>Fluid Vue Example</h1>

    <div class="status">
      <p><strong>Status:</strong> {{ statusMessage }}</p>
    </div>

    <div class="card">
      <h2>Transaction XDR</h2>
      <textarea
        v-model="transactionXdr"
        readonly
        placeholder="Transaction XDR will appear here..."
        rows="4"
      ></textarea>
    </div>

    <div class="card">
      <h2>Request Fee Bump</h2>
      <button
        @click="handleRequestFeeBump"
        :disabled="isLoading || !transactionXdr"
        class="btn"
      >
        {{ isLoading ? "Requesting..." : "Request Fee Bump" }}
      </button>
    </div>

    <div v-if="isLoading" class="card loading">
      <p>Loading...</p>
    </div>

    <div v-if="error" class="card error">
      <h2>Error</h2>
      <p>{{ error.message }}</p>
    </div>

    <div v-if="result" class="card success">
      <h2>Fee Bump Result</h2>
      <p><strong>Status:</strong> {{ result.status }}</p>
      <p v-if="result.hash"><strong>Hash:</strong> {{ result.hash }}</p>
      <p><strong>XDR:</strong></p>
      <textarea readonly :value="result.xdr" rows="4"></textarea>
    </div>
  </div>
</template>

<style scoped>
.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: Arial, sans-serif;
}

h1 {
  color: #333;
  text-align: center;
}

.card {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.card h2 {
  margin-top: 0;
  color: #555;
}

textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  resize: vertical;
}

.btn {
  background: #007bff;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  width: 100%;
}

.btn:hover:not(:disabled) {
  background: #0056b3;
}

.btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.status {
  background: #e7f3ff;
  border-left: 4px solid #007bff;
  padding: 15px;
  margin-bottom: 20px;
}

.loading {
  background: #fff3cd;
  border-left: 4px solid #ffc107;
}

.error {
  background: #f8d7da;
  border-left: 4px solid #dc3545;
}

.success {
  background: #d4edda;
  border-left: 4px solid #28a745;
}
</style>
