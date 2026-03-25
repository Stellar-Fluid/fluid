use std::fmt;
use std::str::FromStr;

use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use stellar_strkey::ed25519::{PrivateKey, PublicKey};
use stellar_strkey::Strkey;
use stellar_xdr::curr::{
    DecoratedSignature, Hash, Limits, MuxedAccount, Preconditions, ReadXdr, Signature,
    SignatureHint, Transaction, TransactionEnvelope, TransactionExt, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV0, Uint256, VecM, WriteXdr,
};
use wasm_bindgen::prelude::*;

const MAX_SIGNATURES: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SigningResult {
    pub signed_xdr: String,
    pub signer_public_key: String,
    pub transaction_hash_hex: String,
    pub signature_count: usize,
}

#[wasm_bindgen]
pub struct WasmSigningResult {
    signed_xdr: String,
    signer_public_key: String,
    transaction_hash_hex: String,
    signature_count: u32,
}

impl From<SigningResult> for WasmSigningResult {
    fn from(value: SigningResult) -> Self {
        Self {
            signed_xdr: value.signed_xdr,
            signer_public_key: value.signer_public_key,
            transaction_hash_hex: value.transaction_hash_hex,
            signature_count: value.signature_count as u32,
        }
    }
}

#[wasm_bindgen]
impl WasmSigningResult {
    #[wasm_bindgen(getter, js_name = signedXdr)]
    pub fn signed_xdr(&self) -> String {
        self.signed_xdr.clone()
    }

    #[wasm_bindgen(getter, js_name = signerPublicKey)]
    pub fn signer_public_key(&self) -> String {
        self.signer_public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = transactionHashHex)]
    pub fn transaction_hash_hex(&self) -> String {
        self.transaction_hash_hex.clone()
    }

    #[wasm_bindgen(getter, js_name = signatureCount)]
    pub fn signature_count(&self) -> u32 {
        self.signature_count
    }
}

#[derive(Debug)]
enum SigningError {
    InvalidSecretKey(String),
    InvalidEnvelope(String),
    UnsupportedEnvelope(String),
    SignatureOverflow,
}

impl fmt::Display for SigningError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidSecretKey(message) => write!(f, "invalid Stellar secret key: {message}"),
            Self::InvalidEnvelope(message) => write!(f, "invalid transaction envelope: {message}"),
            Self::UnsupportedEnvelope(message) => write!(f, "{message}"),
            Self::SignatureOverflow => write!(
                f,
                "transaction already contains the maximum of 20 signatures"
            ),
        }
    }
}

impl std::error::Error for SigningError {}

#[wasm_bindgen(js_name = signTransactionXdr)]
pub fn sign_transaction_xdr(
    unsigned_xdr: &str,
    secret_key: &str,
    network_passphrase: &str,
) -> Result<WasmSigningResult, JsValue> {
    sign_transaction_xdr_internal(unsigned_xdr, secret_key, network_passphrase)
        .map(Into::into)
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen(js_name = transactionHashHex)]
pub fn transaction_hash_hex(
    transaction_xdr: &str,
    network_passphrase: &str,
) -> Result<String, JsValue> {
    let envelope = parse_transaction_envelope(transaction_xdr)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let tx_hash = transaction_hash(&envelope, network_passphrase)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    Ok(hex::encode(tx_hash))
}

#[wasm_bindgen(js_name = publicKeyFromSecret)]
pub fn public_key_from_secret(secret_key: &str) -> Result<String, JsValue> {
    signer_context(secret_key)
        .map(|context| context.public_key)
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

pub fn sign_transaction_xdr_internal(
    unsigned_xdr: &str,
    secret_key: &str,
    network_passphrase: &str,
) -> Result<SigningResult, Box<dyn std::error::Error>> {
    let signer = signer_context(secret_key)?;
    let mut envelope = parse_transaction_envelope(unsigned_xdr)?;
    let tx_hash = transaction_hash(&envelope, network_passphrase)?;
    let signed_envelope = append_signature(&mut envelope, &signer, &tx_hash)?;

    Ok(SigningResult {
        signed_xdr: signed_envelope,
        signer_public_key: signer.public_key,
        transaction_hash_hex: hex::encode(tx_hash),
        signature_count: envelope_signature_count(&envelope),
    })
}

struct SignerContext {
    signing_key: SigningKey,
    public_key: String,
    public_key_bytes: [u8; 32],
}

fn signer_context(secret_key: &str) -> Result<SignerContext, SigningError> {
    let raw_secret = PrivateKey::from_str(secret_key)
        .map_err(|err| SigningError::InvalidSecretKey(err.to_string()))?
        .0;
    let signing_key = SigningKey::from_bytes(&raw_secret);
    let public_key_bytes = signing_key.verifying_key().to_bytes();
    let public_key = Strkey::PublicKeyEd25519(PublicKey(public_key_bytes))
        .to_string()
        .to_string();

    Ok(SignerContext {
        signing_key,
        public_key,
        public_key_bytes,
    })
}

fn parse_transaction_envelope(transaction_xdr: &str) -> Result<TransactionEnvelope, SigningError> {
    TransactionEnvelope::from_xdr_base64(transaction_xdr, Limits::none())
        .map_err(|err| SigningError::InvalidEnvelope(err.to_string()))
}

fn transaction_hash(
    envelope: &TransactionEnvelope,
    network_passphrase: &str,
) -> Result<[u8; 32], SigningError> {
    let tagged_transaction = match envelope {
        TransactionEnvelope::Tx(tx_envelope) => {
            TransactionSignaturePayloadTaggedTransaction::Tx(tx_envelope.tx.clone())
        }
        TransactionEnvelope::TxV0(tx_envelope) => TransactionSignaturePayloadTaggedTransaction::Tx(
            convert_v0_transaction(&tx_envelope.tx),
        ),
        TransactionEnvelope::TxFeeBump(_) => {
            return Err(SigningError::UnsupportedEnvelope(
                "fee-bump envelopes are already wrapped; sign the inner transaction before fee-bumping".to_string(),
            ));
        }
    };

    let payload = TransactionSignaturePayload {
        network_id: Hash(sha256(network_passphrase.as_bytes())),
        tagged_transaction,
    };
    let payload_xdr = payload
        .to_xdr(Limits::none())
        .map_err(|err| SigningError::InvalidEnvelope(err.to_string()))?;

    Ok(sha256(payload_xdr))
}

fn convert_v0_transaction(tx: &TransactionV0) -> Transaction {
    let cond = match tx.time_bounds.clone() {
        Some(time_bounds) => Preconditions::Time(time_bounds),
        None => Preconditions::None,
    };

    Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(tx.source_account_ed25519.0)),
        fee: tx.fee,
        seq_num: tx.seq_num.clone(),
        cond,
        memo: tx.memo.clone(),
        operations: tx.operations.clone(),
        ext: TransactionExt::V0,
    }
}

fn append_signature(
    envelope: &mut TransactionEnvelope,
    signer: &SignerContext,
    tx_hash: &[u8; 32],
) -> Result<String, SigningError> {
    let signature = signer.signing_key.sign(tx_hash).to_bytes().to_vec();
    let decorated_signature = DecoratedSignature {
        hint: SignatureHint(signature_hint(&signer.public_key_bytes)),
        signature: Signature::try_from(signature)
            .map_err(|err| SigningError::InvalidEnvelope(err.to_string()))?,
    };

    match envelope {
        TransactionEnvelope::Tx(tx_envelope) => {
            tx_envelope.signatures =
                push_signature(&tx_envelope.signatures, decorated_signature.clone())?;
        }
        TransactionEnvelope::TxV0(tx_envelope) => {
            tx_envelope.signatures = push_signature(&tx_envelope.signatures, decorated_signature)?;
        }
        TransactionEnvelope::TxFeeBump(_) => {
            return Err(SigningError::UnsupportedEnvelope(
                "fee-bump envelopes are not supported by the signing WASM entrypoint".to_string(),
            ));
        }
    }

    envelope
        .to_xdr_base64(Limits::none())
        .map_err(|err| SigningError::InvalidEnvelope(err.to_string()))
}

fn push_signature(
    signatures: &VecM<DecoratedSignature, 20>,
    signature: DecoratedSignature,
) -> Result<VecM<DecoratedSignature, 20>, SigningError> {
    if signatures.len() >= MAX_SIGNATURES {
        return Err(SigningError::SignatureOverflow);
    }

    let mut signature_list = signatures.to_vec();
    signature_list.push(signature);
    signature_list
        .try_into()
        .map_err(|_| SigningError::SignatureOverflow)
}

fn envelope_signature_count(envelope: &TransactionEnvelope) -> usize {
    match envelope {
        TransactionEnvelope::Tx(tx_envelope) => tx_envelope.signatures.len(),
        TransactionEnvelope::TxV0(tx_envelope) => tx_envelope.signatures.len(),
        TransactionEnvelope::TxFeeBump(tx_envelope) => tx_envelope.signatures.len(),
    }
}

fn signature_hint(public_key: &[u8; 32]) -> [u8; 4] {
    [
        public_key[28],
        public_key[29],
        public_key[30],
        public_key[31],
    ]
}

fn sha256(input: impl AsRef<[u8]>) -> [u8; 32] {
    let digest = Sha256::digest(input);
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&digest);
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
    const TEST_SECRET_KEY: &str = "SDMOYUZMPBA5SDXYC7346UPSFC3LA2QSHWI67M7ZW6G2D55TJ2H3A4IE";
    const TEST_PUBLIC_KEY: &str = "GCF5JWV2NUPVYS3Y7OJNK6GIL7VCRZRY6BAAVLLDS47NKIB2PDVDZNMX";
    const UNSIGNED_XDR: &str = "AAAAAgAAAACL1Nq6bR9cS3j7ktV4yF/qKOY48EAKrWOXPtUgOnjqPAAAAGQAAAAAB1vNFgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAApmbHVpZC13YXNtAAAAAAABAAAAAAAAAAEAAAAAbO4GWuFhrzZ6zHFGQvDxcMZkSolm7txyO8Uc1nvfqWcAAAAAAAAAAAC8YU4AAAAAAAAAAA==";
    const SIGNED_XDR: &str = "AAAAAgAAAACL1Nq6bR9cS3j7ktV4yF/qKOY48EAKrWOXPtUgOnjqPAAAAGQAAAAAB1vNFgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAApmbHVpZC13YXNtAAAAAAABAAAAAAAAAAEAAAAAbO4GWuFhrzZ6zHFGQvDxcMZkSolm7txyO8Uc1nvfqWcAAAAAAAAAAAC8YU4AAAAAAAAAATp46jwAAABAjQnVuBt3qlFlGpktPNGOTW6KQOsocZ/L4VOmmJFKGf+kuc1AegprsHX3Tc4OAqBYBTiwu4bXj/jo+3dfxPSwAA==";
    const TX_HASH_HEX: &str = "a5696ec2ee3daba151f203513532c83b2f415b9ede821a195a90176ffee79b8a";

    #[test]
    fn derives_the_expected_public_key() {
        let signer = signer_context(TEST_SECRET_KEY).unwrap();
        assert_eq!(signer.public_key, TEST_PUBLIC_KEY);
    }

    #[test]
    fn signs_the_fixture_transaction_like_the_js_sdk() {
        let result =
            sign_transaction_xdr_internal(UNSIGNED_XDR, TEST_SECRET_KEY, TEST_NETWORK_PASSPHRASE)
                .unwrap();

        assert_eq!(result.signed_xdr, SIGNED_XDR);
        assert_eq!(result.signer_public_key, TEST_PUBLIC_KEY);
        assert_eq!(result.transaction_hash_hex, TX_HASH_HEX);
        assert_eq!(result.signature_count, 1);
    }

    #[test]
    fn rejects_invalid_secret_keys() {
        let error = signer_context("not-a-secret").unwrap_err();
        let message = error.to_string();

        assert!(message.contains("invalid Stellar secret key"));
    }
}
