use std::{
    process::{Command, Stdio},
    time::Duration,
};

use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use reqwest::Client;
use sha2::{Digest, Sha256};
use stellar_strkey::{ed25519, Strkey};
use stellar_xdr::curr::{
    Asset, DecoratedSignature, Hash, Limits, Memo, MuxedAccount, Operation, OperationBody,
    PaymentOp, Preconditions, SequenceNumber, Signature, SignatureHint, Transaction,
    TransactionEnvelope, TransactionExt, TransactionSignaturePayload,
    TransactionSignaturePayloadTaggedTransaction, TransactionV1Envelope, Uint256, WriteXdr,
};

fn build_secret(seed_byte: u8) -> String {
    format!(
        "{}",
        Strkey::PrivateKeyEd25519(ed25519::PrivateKey([seed_byte; 32]))
    )
}

fn build_signed_transaction_xdr() -> String {
    let secret = [9_u8; 32];
    let signing_key = SigningKey::from_bytes(&secret);
    let source = signing_key.verifying_key().to_bytes();
    let destination = [7_u8; 32];

    let tx = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(source)),
        fee: 100,
        seq_num: SequenceNumber(42),
        cond: Preconditions::None,
        memo: Memo::None,
        operations: vec![Operation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: MuxedAccount::Ed25519(Uint256(destination)),
                asset: Asset::Native,
                amount: 10_000_000,
            }),
        }]
        .try_into()
        .unwrap(),
        ext: TransactionExt::V0,
    };

    let network_hash: [u8; 32] = Sha256::digest("Test SDF Network ; September 2015".as_bytes()).into();
    let payload = TransactionSignaturePayload {
        network_id: Hash(network_hash),
        tagged_transaction: TransactionSignaturePayloadTaggedTransaction::Tx(tx.clone()),
    };
    let payload_xdr = payload.to_xdr(Limits::none()).unwrap();
    let tx_hash: [u8; 32] = Sha256::digest(payload_xdr).into();
    let signature = signing_key.sign(&tx_hash).to_bytes();

    let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
        tx,
        signatures: vec![DecoratedSignature {
            hint: SignatureHint([source[28], source[29], source[30], source[31]]),
            signature: Signature(signature.to_vec().try_into().unwrap()),
        }]
        .try_into()
        .unwrap(),
    });

    base64::engine::general_purpose::STANDARD.encode(envelope.to_xdr(Limits::none()).unwrap())
}

fn node_process_count_in_tree(root_pid: u32) -> usize {
    #[cfg(windows)]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "$all = Get-CimInstance Win32_Process; \
                     $queue = @({root_pid}); \
                     $desc = @(); \
                     while ($queue.Count -gt 0) {{ \
                       $next = @(); \
                       foreach ($pid in $queue) {{ \
                         $children = $all | Where-Object {{ $_.ParentProcessId -eq $pid }}; \
                         $desc += $children; \
                         $next += ($children | Select-Object -ExpandProperty ProcessId); \
                       }} \
                       $queue = $next; \
                     }} \
                     ($desc | Where-Object {{ $_.Name -like 'node*' }} | Measure-Object).Count"
                ),
            ])
            .output()
            .expect("powershell should run");

        return String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .unwrap_or(0);
    }

    #[cfg(not(windows))]
    {
        use std::collections::{HashMap, VecDeque};

        let output = Command::new("ps")
            .args(["-eo", "pid=,ppid=,comm="])
            .output()
            .expect("ps should run");

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut children: HashMap<u32, Vec<(u32, String)>> = HashMap::new();

        for line in stdout.lines() {
            let mut parts = line.split_whitespace();
            let pid = match parts.next().and_then(|p| p.parse::<u32>().ok()) {
                Some(pid) => pid,
                None => continue,
            };
            let ppid = match parts.next().and_then(|p| p.parse::<u32>().ok()) {
                Some(ppid) => ppid,
                None => continue,
            };
            let comm = parts.next().unwrap_or_default().to_string();
            children.entry(ppid).or_default().push((pid, comm));
        }

        let mut queue = VecDeque::from([root_pid]);
        let mut node_count = 0usize;

        while let Some(parent) = queue.pop_front() {
            if let Some(entries) = children.get(&parent) {
                for (pid, comm) in entries {
                    if comm.starts_with("node") {
                        node_count += 1;
                    }
                    queue.push_back(*pid);
                }
            }
        }

        node_count
    }
}

#[tokio::test]
async fn rust_server_handles_static_and_api_without_node() {
    let port = "3222";
    let server_bin = env!("CARGO_BIN_EXE_fluid-server");
    let fee_payer_secret = build_secret(4);
    let signed_xdr = build_signed_transaction_xdr();

    let mut child = Command::new(server_bin)
        .env("PORT", port)
        .env("FLUID_FEE_PAYER_SECRET", &fee_payer_secret)
        .env("STELLAR_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("rust server should spawn");

    let client = Client::new();

    for _ in 0..40 {
        if client
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false)
        {
            break;
        }

        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let routes = vec![
        (
            "/",
            client
                .get(format!("http://127.0.0.1:{port}/"))
                .send()
                .await
                .unwrap()
                .status(),
        ),
        (
            "/health",
            client
                .get(format!("http://127.0.0.1:{port}/health"))
                .send()
                .await
                .unwrap()
                .status(),
        ),
        (
            "/test/add-transaction",
            client
                .post(format!("http://127.0.0.1:{port}/test/add-transaction"))
                .json(&serde_json::json!({
                    "hash": "rust-only-hash",
                    "status": "pending"
                }))
                .send()
                .await
                .unwrap()
                .status(),
        ),
        (
            "/test/transactions",
            client
                .get(format!("http://127.0.0.1:{port}/test/transactions"))
                .send()
                .await
                .unwrap()
                .status(),
        ),
        (
            "/fee-bump",
            client
                .post(format!("http://127.0.0.1:{port}/fee-bump"))
                .header("content-type", "application/json")
                .header("x-api-key", "fluid-pro-demo-key")
                .body(
                    serde_json::json!({
                        "xdr": signed_xdr,
                        "submit": false
                    })
                    .to_string(),
                )
                .send()
                .await
                .unwrap()
                .status(),
        ),
    ];

    for (route, status) in &routes {
        let node_count = node_process_count_in_tree(child.id());
        println!(
            "RUST_ONLY route={} status={} node_processes_in_tree={}",
            route,
            status.as_u16(),
            node_count
        );
        assert_eq!(node_count, 0, "node.exe should not be in the Rust server process tree");
        assert!(status.is_success(), "{} should succeed", route);
    }

    child.kill().expect("rust server should stop");
}
