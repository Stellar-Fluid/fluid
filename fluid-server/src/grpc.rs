use std::net::SocketAddr;

use tonic::{transport::Server, Request, Response, Status};
use tracing::info;

use crate::{sign_transaction_xdr_internal, SigningError};

pub mod signer {
    tonic::include_proto!("signer");
}

use signer::signer_service_server::{SignerService, SignerServiceServer};
use signer::{SignRequest, SignResponse};

#[derive(Default)]
pub struct FluidSignerGrpc;

#[tonic::async_trait]
impl SignerService for FluidSignerGrpc {
    async fn sign(&self, request: Request<SignRequest>) -> Result<Response<SignResponse>, Status> {
        let request = request.into_inner();

        if request.xdr.trim().is_empty() {
            return Err(Status::invalid_argument("xdr is required"));
        }
        if request.secret_key.trim().is_empty() {
            return Err(Status::invalid_argument("secret_key is required"));
        }
        if request.network_passphrase.trim().is_empty() {
            return Err(Status::invalid_argument("network_passphrase is required"));
        }

        info!("SignRequest received | xdr_len={}", request.xdr.len());

        let result = sign_transaction_xdr_internal(
            &request.xdr,
            &request.secret_key,
            &request.network_passphrase,
        )
        .map_err(map_signing_error)?;

        info!(
            "SignResponse sent | signer={} signatures={}",
            result.signer_public_key, result.signature_count
        );

        Ok(Response::new(SignResponse {
            signed_xdr: result.signed_xdr,
            signer_public_key: result.signer_public_key,
            transaction_hash_hex: result.transaction_hash_hex,
            signature_count: result.signature_count as u32,
        }))
    }
}

fn map_signing_error(error: SigningError) -> Status {
    match error {
        SigningError::InvalidSecretKey(message) => Status::invalid_argument(message),
        SigningError::InvalidEnvelope(message) => Status::invalid_argument(message),
        SigningError::UnsupportedEnvelope(message) => Status::failed_precondition(message),
        SigningError::SignatureOverflow => Status::resource_exhausted(error.to_string()),
    }
}

pub async fn serve_grpc(addr: SocketAddr) -> Result<(), Box<dyn std::error::Error>> {
    info!("Fluid signer gRPC listening on {addr}");

    Server::builder()
        .add_service(SignerServiceServer::new(FluidSignerGrpc))
        .serve(addr)
        .await?;

    Ok(())
}
