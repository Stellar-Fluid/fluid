use base64::{engine::general_purpose::STANDARD, Engine};
use stellar_xdr::curr::{
    FeeBumpTransaction, FeeBumpTransactionInnerTx, Limits, Operation, ReadXdr, Transaction,
    TransactionEnvelope, TransactionV0,
};
use tracing::info;

/// A parsed Stellar transaction covering all envelope variants.
#[derive(Debug)]
pub enum ParsedTransaction {
    /// Legacy V0 classic transaction (pre-muxed-account era).
    V0(Box<TransactionV0>),
    /// Current classic V1 transaction.
    V1(Box<Transaction>),
    /// Fee-bump envelope wrapping an inner V1 transaction.
    FeeBump(Box<FeeBumpTransaction>),
}

/// Errors produced by [`parse_xdr`].
#[derive(Debug)]
pub enum XdrError {
    Base64(base64::DecodeError),
    Xdr(stellar_xdr::curr::Error),
}

impl std::fmt::Display for XdrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            XdrError::Base64(e) => write!(f, "base64 decode error: {e}"),
            XdrError::Xdr(e) => write!(f, "XDR parse error: {e}"),
        }
    }
}

impl std::error::Error for XdrError {}

impl From<base64::DecodeError> for XdrError {
    fn from(e: base64::DecodeError) -> Self {
        XdrError::Base64(e)
    }
}

impl From<stellar_xdr::curr::Error> for XdrError {
    fn from(e: stellar_xdr::curr::Error) -> Self {
        XdrError::Xdr(e)
    }
}

/// Parse a base64-encoded XDR string into a [`ParsedTransaction`].
///
/// Supports classic V0, classic V1, and fee-bump envelope types.
/// Leading/trailing whitespace is stripped before decoding.
/// Returns [`XdrError`] on invalid base64 or malformed XDR.
pub fn parse_xdr(base64_string: &str) -> Result<ParsedTransaction, XdrError> {
    // Zero-copy decode path: decode base64 into bytes, then parse XDR in-place.
    let bytes = STANDARD.decode(base64_string.trim())?;
    let envelope = TransactionEnvelope::from_xdr(bytes, Limits::none())?;

    let parsed = match envelope {
        TransactionEnvelope::TxV0(env) => ParsedTransaction::V0(Box::new(env.tx)),
        TransactionEnvelope::Tx(env) => ParsedTransaction::V1(Box::new(env.tx)),
        TransactionEnvelope::TxFeeBump(env) => ParsedTransaction::FeeBump(Box::new(env.tx)),
    };

    Ok(parsed)
}

/// Emit structured `tracing` logs showing the full operation breakdown.
///
/// Required per issue #41: logs must show each operation's type and index.
pub fn log_xdr_breakdown(parsed: &ParsedTransaction) {
    match parsed {
        ParsedTransaction::V0(tx) => {
            info!(
                tx_type = "ClassicV0",
                fee = tx.fee,
                seq_num = tx.seq_num.0,
                op_count = tx.operations.len(),
                "parsed transaction"
            );
            for (i, op) in tx.operations.iter().enumerate() {
                log_operation(i, op);
            }
        }
        ParsedTransaction::V1(tx) => {
            info!(
                tx_type = "ClassicV1",
                fee = tx.fee,
                seq_num = tx.seq_num.0,
                op_count = tx.operations.len(),
                "parsed transaction"
            );
            for (i, op) in tx.operations.iter().enumerate() {
                log_operation(i, op);
            }
        }
        ParsedTransaction::FeeBump(tx) => {
            info!(tx_type = "FeeBump", fee = tx.fee, "parsed transaction");
            match &tx.inner_tx {
                FeeBumpTransactionInnerTx::Tx(inner_env) => {
                    let inner = &inner_env.tx;
                    info!(
                        inner_type = "ClassicV1",
                        fee = inner.fee,
                        seq_num = inner.seq_num.0,
                        op_count = inner.operations.len(),
                        "inner transaction"
                    );
                    for (i, op) in inner.operations.iter().enumerate() {
                        log_operation(i, op);
                    }
                }
            }
        }
    }
}

fn log_operation(index: usize, op: &Operation) {
    info!(index, op_type = op.body.name(), "operation");
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use stellar_xdr::curr::{
        Asset, FeeBumpTransaction, FeeBumpTransactionEnvelope, FeeBumpTransactionExt,
        FeeBumpTransactionInnerTx, Limits, Memo, MuxedAccount, Operation, OperationBody,
        PaymentOp, Preconditions, SequenceNumber, TimeBounds, Transaction, TransactionEnvelope,
        TransactionExt, TransactionV0, TransactionV0Envelope, TransactionV0Ext, TransactionV1Envelope,
        Uint256, VecM, WriteXdr,
    };

    /// Build a minimal Classic V1 transaction with a single Payment op.
    fn classic_v1_xdr() -> String {
        let source = MuxedAccount::Ed25519(Uint256([0u8; 32]));
        let dest = MuxedAccount::Ed25519(Uint256([1u8; 32]));

        let op = Operation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: dest,
                asset: Asset::Native,
                amount: 10_000_000, // 1 XLM
            }),
        };

        let tx = Transaction {
            source_account: source,
            fee: 100,
            seq_num: SequenceNumber(42),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![op].try_into().unwrap(),
            ext: TransactionExt::V0,
        };

        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: VecM::default(),
        });

        let bytes = envelope.to_xdr(Limits::none()).unwrap();
        STANDARD.encode(bytes)
    }

    /// Build a minimal Classic V0 transaction with a single Payment op.
    fn classic_v0_xdr() -> String {
        let source_ed25519 = Uint256([0u8; 32]);
        let dest = MuxedAccount::Ed25519(Uint256([1u8; 32]));

        let op = Operation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: dest,
                asset: Asset::Native,
                amount: 10_000_000, // 1 XLM
            }),
        };

        let tx = TransactionV0 {
            source_account_ed25519: source_ed25519,
            fee: 100,
            seq_num: SequenceNumber(1),
            time_bounds: Option::<TimeBounds>::None,
            memo: Memo::None,
            operations: vec![op].try_into().unwrap(),
            ext: TransactionV0Ext::V0,
        };

        let envelope = TransactionEnvelope::TxV0(TransactionV0Envelope {
            tx,
            signatures: VecM::default(),
        });

        let bytes = envelope.to_xdr(Limits::none()).unwrap();
        STANDARD.encode(bytes)
    }

    /// Build a Classic V1 transaction with multiple operation types.
    fn multi_op_xdr() -> String {
        let source = MuxedAccount::Ed25519(Uint256([0u8; 32]));
        let dest = MuxedAccount::Ed25519(Uint256([1u8; 32]));

        let ops: Vec<Operation> = vec![
            Operation {
                source_account: None,
                body: OperationBody::Payment(PaymentOp {
                    destination: dest.clone(),
                    asset: Asset::Native,
                    amount: 5_000_000,
                }),
            },
            Operation {
                source_account: None,
                body: OperationBody::Payment(PaymentOp {
                    destination: dest,
                    asset: Asset::Native,
                    amount: 5_000_000,
                }),
            },
        ];

        let tx = Transaction {
            source_account: source,
            fee: 200,
            seq_num: SequenceNumber(99),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: ops.try_into().unwrap(),
            ext: TransactionExt::V0,
        };

        let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
            tx,
            signatures: VecM::default(),
        });

        let bytes = envelope.to_xdr(Limits::none()).unwrap();
        STANDARD.encode(bytes)
    }

    /// Build a Fee-Bump transaction wrapping an inner Classic V1 tx.
    fn fee_bump_xdr() -> String {
        let inner_source = MuxedAccount::Ed25519(Uint256([0u8; 32]));
        let dest = MuxedAccount::Ed25519(Uint256([1u8; 32]));

        let op = Operation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: dest,
                asset: Asset::Native,
                amount: 10_000_000,
            }),
        };

        let inner_tx = Transaction {
            source_account: inner_source,
            fee: 100,
            seq_num: SequenceNumber(7),
            cond: Preconditions::None,
            memo: Memo::None,
            operations: vec![op].try_into().unwrap(),
            ext: TransactionExt::V0,
        };

        let fee_source = MuxedAccount::Ed25519(Uint256([2u8; 32]));

        let fee_bump = FeeBumpTransaction {
            fee_source,
            fee: 500,
            inner_tx: FeeBumpTransactionInnerTx::Tx(TransactionV1Envelope {
                tx: inner_tx,
                signatures: VecM::default(),
            }),
            ext: FeeBumpTransactionExt::V0,
        };

        let envelope = TransactionEnvelope::TxFeeBump(FeeBumpTransactionEnvelope {
            tx: fee_bump,
            signatures: VecM::default(),
        });

        let bytes = envelope.to_xdr(Limits::none()).unwrap();
        STANDARD.encode(bytes)
    }

    // ── Initialise tracing once for tests that need log output ───────────────

    fn init_tracing() {
        let _ = tracing_subscriber::fmt()
            .with_test_writer()
            .with_max_level(tracing::Level::INFO)
            .try_init();
    }

    // ── Happy-path tests ─────────────────────────────────────────────────────

    #[test]
    fn test_parse_classic_v1() {
        init_tracing();
        let xdr = classic_v1_xdr();
        let parsed = parse_xdr(&xdr).expect("valid XDR should parse");

        assert!(
            matches!(parsed, ParsedTransaction::V1(_)),
            "expected V1, got {parsed:?}"
        );

        if let ParsedTransaction::V1(ref tx) = parsed {
            assert_eq!(tx.fee, 100);
            assert_eq!(tx.seq_num.0, 42);
            assert_eq!(tx.operations.len(), 1);
            assert!(matches!(tx.operations[0].body, OperationBody::Payment(_)));

            println!("\n=== Classic V1 Transaction Breakdown ===");
            println!("  tx_type  : ClassicV1");
            println!("  fee      : {} stroops", tx.fee);
            println!("  seq_num  : {}", tx.seq_num.0);
            println!("  op_count : {}", tx.operations.len());
            for (i, op) in tx.operations.iter().enumerate() {
                println!("  op[{i}]    : {}", op.body.name());
            }
        }

        log_xdr_breakdown(&parsed);
    }

    #[test]
    fn test_parse_classic_v0() {
        init_tracing();
        let xdr = classic_v0_xdr();
        let parsed = parse_xdr(&xdr).expect("valid V0 XDR should parse");

        assert!(
            matches!(parsed, ParsedTransaction::V0(_)),
            "expected V0, got {parsed:?}"
        );

        log_xdr_breakdown(&parsed);
    }

    #[test]
    fn test_parse_multi_op_classic() {
        init_tracing();
        let xdr = multi_op_xdr();
        let parsed = parse_xdr(&xdr).expect("multi-op XDR should parse");

        if let ParsedTransaction::V1(ref tx) = parsed {
            assert_eq!(tx.operations.len(), 2);
            assert_eq!(tx.fee, 200);

            println!("\n=== Multi-Op Classic V1 Breakdown ===");
            println!("  fee      : {} stroops", tx.fee);
            println!("  seq_num  : {}", tx.seq_num.0);
            println!("  op_count : {}", tx.operations.len());
            for (i, op) in tx.operations.iter().enumerate() {
                println!("  op[{i}]    : {}", op.body.name());
            }
        } else {
            panic!("expected V1, got {parsed:?}");
        }

        log_xdr_breakdown(&parsed);
    }

    #[test]
    fn test_parse_fee_bump() {
        init_tracing();
        let xdr = fee_bump_xdr();
        let parsed = parse_xdr(&xdr).expect("fee-bump XDR should parse");

        assert!(
            matches!(parsed, ParsedTransaction::FeeBump(_)),
            "expected FeeBump, got {parsed:?}"
        );

        if let ParsedTransaction::FeeBump(ref fb) = parsed {
            assert_eq!(fb.fee, 500);

            println!("\n=== Fee-Bump Transaction Breakdown ===");
            println!("  tx_type  : FeeBump");
            println!("  fee      : {} stroops", fb.fee);

            let FeeBumpTransactionInnerTx::Tx(ref inner_env) = fb.inner_tx;
            let inner = &inner_env.tx;
            println!("  inner.fee      : {} stroops", inner.fee);
            println!("  inner.seq_num  : {}", inner.seq_num.0);
            println!("  inner.op_count : {}", inner.operations.len());
            for (i, op) in inner.operations.iter().enumerate() {
                println!("  inner.op[{i}]    : {}", op.body.name());
            }
        }

        log_xdr_breakdown(&parsed);
    }

    // ── Error-handling tests ─────────────────────────────────────────────────

    #[test]
    fn test_invalid_base64_returns_error() {
        let result = parse_xdr("not!!!valid===base64");
        assert!(
            matches!(result, Err(XdrError::Base64(_))),
            "expected Base64 error, got {result:?}"
        );
    }

    #[test]
    fn xdr_error_display_includes_base64_context() {
        let err = parse_xdr("not!!!valid===base64").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("base64 decode error"), "msg: {msg}");
    }

    #[test]
    fn test_malformed_xdr_returns_error() {
        // Valid base64 but not valid XDR.
        let b64 = STANDARD.encode(b"this is definitely not XDR data");
        let result = parse_xdr(&b64);
        assert!(
            matches!(result, Err(XdrError::Xdr(_))),
            "expected Xdr error, got {result:?}"
        );
    }

    #[test]
    fn xdr_error_display_includes_xdr_context() {
        // Valid base64 but not valid XDR.
        let b64 = STANDARD.encode(b"this is definitely not XDR data");
        let err = parse_xdr(&b64).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("XDR parse error"), "msg: {msg}");
    }

    #[test]
    fn test_whitespace_is_trimmed() {
        let xdr = classic_v1_xdr();
        let padded = format!("   {xdr}   \n");
        let result = parse_xdr(&padded);
        assert!(result.is_ok(), "whitespace-padded XDR should parse: {result:?}");
    }

    #[test]
    fn test_empty_string_returns_error() {
        let result = parse_xdr("");
        assert!(result.is_err(), "empty string should return an error");
    }
}
