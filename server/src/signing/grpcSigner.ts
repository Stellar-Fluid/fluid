import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join } from "path";

interface SignRequest {
  xdr: string;
  secret_key: string;
  network_passphrase: string;
}

interface SignResponse {
  signed_xdr: string;
  signer_public_key: string;
  transaction_hash_hex: string;
  signature_count: number;
}

type SignCallback = (error: grpc.ServiceError | null, response: SignResponse) => void;

interface SignerServiceClient {
  sign(
    request: SignRequest,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: SignCallback
  ): grpc.ClientUnaryCall;
}

class GrpcSigner {
  private readonly address: string;
  private readonly timeoutMs: number;
  private readonly client: SignerServiceClient;

  constructor() {
    this.address = process.env.FLUID_SIGNER_GRPC_ADDR || "127.0.0.1:50051";
    this.timeoutMs = Number(process.env.FLUID_SIGNER_GRPC_TIMEOUT_MS || "3000");

    const protoPath = join(__dirname, "../../../proto/signer.proto");
    const packageDefinition = protoLoader.loadSync(protoPath, {
      enums: String,
      keepCase: true,
      longs: String,
      oneofs: true,
    });

    const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
      signer: {
        SignerService: new (
          address: string,
          credentials: grpc.ChannelCredentials
        ) => SignerServiceClient;
      };
    };

    this.client = new loaded.signer.SignerService(
      this.address,
      grpc.credentials.createInsecure()
    );
  }

  async signXdr(
    xdr: string,
    secretKey: string,
    networkPassphrase: string
  ): Promise<SignResponse> {
    const request: SignRequest = {
      xdr,
      secret_key: secretKey,
      network_passphrase: networkPassphrase,
    };

    console.log(`[gRPC] SignRequest -> ${this.address} | xdr_len=${xdr.length}`);

    return new Promise((resolve, reject) => {
      const metadata = new grpc.Metadata();
      const options: grpc.CallOptions = {
        deadline: new Date(Date.now() + this.timeoutMs),
      };

      this.client.sign(request, metadata, options, (error, response) => {
        if (error) {
          reject(new Error(formatGrpcError(error)));
          return;
        }

        console.log(
          `[gRPC] SignResponse <- ${this.address} | signer=${response.signer_public_key} signatures=${response.signature_count}`
        );

        resolve(response);
      });
    });
  }
}

function formatGrpcError(error: grpc.ServiceError): string {
  const details = error.details || "unknown gRPC error";
  return `gRPC signer error (${error.code}): ${details}`;
}

export const grpcSigner = new GrpcSigner();
