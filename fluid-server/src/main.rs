mod db;
mod metrics;
mod state;
mod stellar;
mod xdr;

use axum::{
    extract::{ConnectInfo, Extension, Request, State},
    http::{
        header::{self, HeaderMap, HeaderName, HeaderValue},
        Method, Uri,
    },
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use fluid_server::config::load_config;
use db::create_pool;
use fluid_server::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use state::{
    iso_now, utc_day_start_ms, ApiKeyConfig, AppState, HealthFeePayer, HorizonNodeStatus,
    RateLimitEntry, RateLimitResult, TransactionRecord, API_KEYS, REVALIDATION_INTERVAL_SECS,
};
use std::{net::SocketAddr, sync::Arc, time::Instant};
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tracing::{error, info};
use xdr::summarize_transaction;

#[derive(Serialize)]
struct HealthResponse {
    fee_payers: Vec<HealthFeePayer>,
    horizon_nodes: Vec<HorizonNodeStatus>,
    status: &'static str,
    total: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FeeBumpRequest {
    submit: Option<bool>,
    token: Option<String>,
    xdr: String,
}

#[derive(Serialize)]
struct FeeBumpReadyResponse {
    fee_payer: String,
    status: &'static str,
    xdr: String,
}

#[derive(Serialize)]
struct FeeBumpSubmittedResponse {
    fee_payer: String,
    hash: String,
    status: &'static str,
    submission_attempts: usize,
    submitted_via: String,
    xdr: String,
}

#[derive(Deserialize)]
struct AddTransactionRequest {
    hash: String,
    status: Option<String>,
}

#[derive(Serialize)]
struct AddTransactionResponse {
    message: String,
}

#[derive(Serialize)]
struct TransactionsResponse {
    transactions: Vec<TransactionRecord>,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    error: String,
}

#[derive(Serialize)]
struct DbVerificationResponse {
    status: &'static str,
    message: String,
}

async fn verify_db(db_pool: Option<Extension<Arc<PgPool>>>) -> Json<DbVerificationResponse> {
    let Some(Extension(db_pool)) = db_pool else {
        return Json(DbVerificationResponse {
            status: "error",
            message: "Database pool is not configured for this server instance".to_string(),
        });
    };

    match sqlx::query("SELECT 1").execute(db_pool.as_ref()).await {
        Ok(_) => info!("Database health check passed"),
        Err(err) => {
            error!("Database health check failed: {}", err);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Database health check failed: {}", err),
            });
        }
    }

    match db::TenantRepo::list_all(db_pool.as_ref()).await {
        Ok(tenants) => info!(
            "Successfully queried Tenant table: {} tenants found",
            tenants.len()
        ),
        Err(err) => {
            error!("Failed to query Tenant table: {}", err);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Failed to query Tenant table: {}", err),
            });
        }
    }

    let test_hash = format!("test_{}", uuid::Uuid::new_v4());
    match db::TransactionRepo::insert(db_pool.as_ref(), &test_hash, "pending").await {
        Ok(tx) => info!(
            "Successfully inserted test transaction: hash={}, status={}",
            tx.hash, tx.status
        ),
        Err(err) => {
            error!("Failed to insert test transaction: {}", err);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Failed to insert transaction: {}", err),
            });
        }
    }

    Json(DbVerificationResponse {
        status: "ok",
        message: "Database connectivity and operations verified successfully".to_string(),
    })
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fluid_server=info,tower_http=info".into()),
        )
        .init();

    if let Err(error) = run().await {
        error!("{}", error.message);
        std::process::exit(1);
    }
}

async fn run() -> Result<(), AppError> {
    let (config, secrets) = load_config()?;
    let port = config.port;
    let allowed_origins = config.allowed_origins.clone();
    let state = AppState::new(config, &secrets)?;

    // Background task: periodically revalidate signer accounts and refresh balances
    {
        let pool = Arc::clone(&state.signer_pool);
        let horizon_urls = state.config.horizon_urls.clone();
        let client = reqwest::Client::new();
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(std::time::Duration::from_secs(REVALIDATION_INTERVAL_SECS));
            interval.tick().await; // skip immediate first tick
            loop {
                interval.tick().await;
                if let Some(url) = horizon_urls.first() {
                    info!("[LoadBalancer] Running signer pool revalidation");
                    pool.revalidate(url, &client).await;
                }
            }
        });
    }

    let app = Router::new()
        .route("/", get(dashboard))
        .route("/dashboard", get(dashboard))
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/verify-db", get(verify_db))
        .route("/fee-bump", post(fee_bump))
        .route("/test/add-transaction", post(add_transaction))
        .route("/test/transactions", get(list_transactions))
        .fallback(not_found)
        .layer(build_cors_layer(&allowed_origins))
        .with_state(state);

    let app = match create_pool().await {
        Ok(pool) => {
            info!("Database pool created successfully");
            app.layer(Extension(Arc::new(pool)))
        }
        Err(error) => {
            error!("Database pool unavailable, continuing without verify-db support: {error}");
            app
        }
    };

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Fluid server (Rust) listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|error| {
        AppError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            format!("Failed to bind TCP listener: {error}"),
        )
    })?;

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|error| {
        AppError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            format!("Rust server exited unexpectedly: {error}"),
        )
    })
}

fn build_cors_layer(allowed_origins: &[String]) -> CorsLayer {
    let headers = AllowHeaders::list([header::CONTENT_TYPE, HeaderName::from_static("x-api-key")]);

    if allowed_origins.is_empty() {
        return CorsLayer::new()
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(headers)
            .allow_origin(AllowOrigin::any());
    }

    let values: Vec<HeaderValue> = allowed_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect();

    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(headers)
        .allow_origin(AllowOrigin::list(values))
}

async fn dashboard() -> Html<&'static str> {
    Html(DASHBOARD_HTML)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let fee_payers = state.signer_pool.snapshot().await;
    let horizon_nodes = state.horizon.statuses().await;

    let known_balance_sum = fee_payers
        .iter()
        .filter_map(|payer| payer.balance.as_deref())
        .filter_map(|value| value.parse::<f64>().ok())
        .sum::<f64>();
    if known_balance_sum > 0.0 {
        state
            .metrics
            .set_available_account_balance(known_balance_sum);
    }

    Json(HealthResponse {
        total: fee_payers.len(),
        fee_payers,
        horizon_nodes,
        status: "ok",
    })
}

async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    match state.metrics.render() {
        Ok(body) => (
            axum::http::StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
            body,
        )
            .into_response(),
        Err(err) => AppError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            format!("Failed to render metrics: {err}"),
        )
        .into_response(),
    }
}

async fn add_transaction(
    State(state): State<AppState>,
    Json(request): Json<AddTransactionRequest>,
) -> Result<Json<AddTransactionResponse>, AppError> {
    if request.hash.trim().is_empty() {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "INVALID_XDR",
            "Transaction hash is required",
        ));
    }

    let status = request.status.unwrap_or_else(|| "pending".to_string());
    let now = iso_now();
    state.transaction_store.lock().await.insert(
        request.hash.clone(),
        TransactionRecord {
            created_at: now.clone(),
            hash: request.hash.clone(),
            status: status.clone(),
            updated_at: now,
        },
    );

    Ok(Json(AddTransactionResponse {
        message: format!("Transaction {} added with status {}", request.hash, status),
    }))
}

async fn list_transactions(State(state): State<AppState>) -> Json<TransactionsResponse> {
    let transactions = state
        .transaction_store
        .lock()
        .await
        .values()
        .cloned()
        .collect();
    Json(TransactionsResponse { transactions })
}

async fn fee_bump(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<FeeBumpRequest>,
) -> Result<Response, AppError> {
    state.metrics.inc_total_transactions();
    let started_at = Instant::now();

    let result = fee_bump_inner(&state, addr, &headers, body).await;

    state
        .metrics
        .observe_signing_latency_ms(started_at.elapsed().as_secs_f64() * 1_000.0);

    if matches!(&result, Err(_))
        || matches!(&result, Ok(response) if response.status().is_client_error() || response.status().is_server_error())
    {
        state.metrics.inc_failed_transactions();
    }

    result
}

async fn fee_bump_inner(
    state: &AppState,
    addr: SocketAddr,
    headers: &HeaderMap,
    body: FeeBumpRequest,
) -> Result<Response, AppError> {
    if body.xdr.trim().is_empty() {
        return Err(AppError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "INVALID_XDR",
            "Validation failed: xdr field is required and must be a non-empty string",
        ));
    }

    let api_key = extract_api_key(headers)?;
    let api_key_config = find_api_key(&api_key)?;
    let ip_limit = state
        .global_limiter
        .check(&format!("ip:{}", addr.ip()))
        .await?;
    let api_limit = check_api_key_rate_limit(state, &api_key_config).await?;

    let signer_lease = state.signer_pool.acquire().await?;
    let fee_payer = signer_lease.account.public_key.clone();
    let signer_index = signer_lease.index;
    info!("Received fee-bump request | fee_payer: {fee_payer}");

    let result = match stellar::create_fee_bump_transaction(
        &body.xdr,
        &state.config.network_passphrase,
        state.config.base_fee,
        state.config.fee_multiplier,
        &signer_lease.account.secret,
        &signer_lease.account.public_key_bytes,
    ) {
        Ok(result) => result,
        Err(err) => {
            signer_lease.release().await;
            return Err(err);
        }
    };
    xdr::log_xdr_breakdown(&result.parsed_inner);

    let summary = summarize_transaction(&result.parsed_inner);
    state
        .metrics
        .set_current_sequence_number(summary.transaction_type, summary.sequence_number);

    let current_spend: i64 = state
        .quota_ledger
        .lock()
        .await
        .iter()
        .filter(|record| {
            record.tenant_id == api_key_config.tenant_id
                && record.created_at_ms >= utc_day_start_ms()
        })
        .map(|record| record.fee_stroops)
        .sum();

    if current_spend + result.fee_amount > api_key_config.daily_quota_stroops {
        signer_lease.release().await;
        return Ok(with_limit_headers(
            (
                axum::http::StatusCode::FORBIDDEN,
                Json(serde_json::json!({
                    "attemptedFeeStroops": result.fee_amount,
                    "currentSpendStroops": current_spend,
                    "dailyQuotaStroops": api_key_config.daily_quota_stroops,
                    "error": "Daily fee sponsorship quota exceeded"
                })),
            )
                .into_response(),
            &ip_limit,
            &api_limit,
        ));
    }

    state
        .quota_ledger
        .lock()
        .await
        .push(state::SponsoredTransactionRecord {
            created_at_ms: state::now_ms(),
            fee_stroops: result.fee_amount,
            tenant_id: api_key_config.tenant_id.to_string(),
        });

    if !body.submit.unwrap_or(false) {
        let response = Json(FeeBumpReadyResponse {
            fee_payer,
            status: "ready",
            xdr: result.fee_bump_xdr,
        })
        .into_response();
        signer_lease.release().await;
        return Ok(with_limit_headers(response, &ip_limit, &api_limit));
    }

    if state.config.horizon_urls.is_empty() {
        signer_lease.release().await;
        return Err(AppError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "SUBMISSION_FAILED",
            "Transaction submission requested but no Horizon URLs are configured",
        ));
    }

    let submission = match state.horizon.submit_transaction(&result.fee_bump_xdr).await {
        Ok(submission) => {
            state.signer_pool.report_success(signer_index).await;
            submission
        }
        Err(err) => {
            state
                .signer_pool
                .report_failure(signer_index, &err.message)
                .await;
            signer_lease.release().await;
            return Err(err);
        }
    };
    let now = iso_now();
    state.transaction_store.lock().await.insert(
        submission.hash.clone(),
        TransactionRecord {
            created_at: now.clone(),
            hash: submission.hash.clone(),
            status: "submitted".to_string(),
            updated_at: now,
        },
    );

    let response = Json(FeeBumpSubmittedResponse {
        fee_payer,
        hash: submission.hash,
        status: "submitted",
        submission_attempts: submission.attempts,
        submitted_via: submission.node_url,
        xdr: result.fee_bump_xdr,
    })
    .into_response();
    signer_lease.release().await;
    Ok(with_limit_headers(response, &ip_limit, &api_limit))
}

async fn not_found(uri: Uri, request: Request) -> Response {
    (
        axum::http::StatusCode::NOT_FOUND,
        Json(ErrorBody {
            code: "NOT_FOUND",
            error: format!("Route {} {} not found", request.method(), uri.path()),
        }),
    )
        .into_response()
}

fn with_limit_headers(
    mut response: Response,
    ip_limit: &RateLimitResult,
    api_limit: &RateLimitResult,
) -> Response {
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-ratelimit-limit"),
        HeaderValue::from_str(&api_limit.limit.to_string())
            .unwrap_or(HeaderValue::from_static("0")),
    );
    headers.insert(
        HeaderName::from_static("x-ratelimit-remaining"),
        HeaderValue::from_str(&api_limit.remaining.to_string())
            .unwrap_or(HeaderValue::from_static("0")),
    );
    headers.insert(
        HeaderName::from_static("x-ratelimit-reset"),
        HeaderValue::from_str(&api_limit.reset_time_epoch_seconds.to_string())
            .unwrap_or(HeaderValue::from_static("0")),
    );
    headers.insert(
        HeaderName::from_static("x-global-ratelimit-limit"),
        HeaderValue::from_str(&ip_limit.limit.to_string()).unwrap_or(HeaderValue::from_static("0")),
    );
    response
}

fn extract_api_key(headers: &HeaderMap) -> Result<String, AppError> {
    headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            AppError::new(
                axum::http::StatusCode::UNAUTHORIZED,
                "AUTH_FAILED",
                "Missing API key. Provide a valid x-api-key header to access this endpoint.",
            )
        })
}

fn find_api_key(api_key: &str) -> Result<ApiKeyConfig, AppError> {
    API_KEYS
        .iter()
        .find(|candidate| candidate.key == api_key)
        .cloned()
        .ok_or_else(|| {
            AppError::new(
                axum::http::StatusCode::FORBIDDEN,
                "AUTH_FAILED",
                "Invalid API key.",
            )
        })
}

async fn check_api_key_rate_limit(
    state: &AppState,
    api_key: &ApiKeyConfig,
) -> Result<RateLimitResult, AppError> {
    let mut guard = state.api_key_limiter.lock().await;
    let now_ms = state::now_ms();
    let entry = guard
        .entry(api_key.key.to_string())
        .or_insert_with(|| RateLimitEntry {
            count: 0,
            reset_time_ms: now_ms + u128::from(api_key.window_ms),
        });

    if now_ms >= entry.reset_time_ms {
        entry.count = 0;
        entry.reset_time_ms = now_ms + u128::from(api_key.window_ms);
    }

    if entry.count >= api_key.max_requests {
        return Err(AppError::new(
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            format!(
                "API key rate limit exceeded for {} ({} tier).",
                mask_api_key(api_key.key),
                api_key.tier
            ),
        ));
    }

    entry.count += 1;

    Ok(RateLimitResult {
        limit: api_key.max_requests,
        remaining: api_key.max_requests.saturating_sub(entry.count),
        reset_time_epoch_seconds: (entry.reset_time_ms / 1_000) as u64,
    })
}

fn mask_api_key(api_key: &str) -> String {
    if api_key.len() <= 8 {
        return format!("{}***", &api_key[..2.min(api_key.len())]);
    }

    format!("{}...{}", &api_key[..4], &api_key[api_key.len() - 4..])
}

const DASHBOARD_HTML: &str = r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fluid Rust Dashboard</title>
    <style>
      :root { --ink:#102030; --surface:#f6efe2; --card:rgba(255,255,255,0.82); }
      body { margin:0; font-family:Georgia,"Times New Roman",serif; color:var(--ink);
        background:radial-gradient(circle at top left, rgba(242,143,59,0.24), transparent 30%),
        radial-gradient(circle at right, rgba(18,107,95,0.22), transparent 40%),
        linear-gradient(135deg, #f5e7cc, var(--surface)); }
      main { max-width:980px; margin:0 auto; padding:48px 20px 72px; }
      .hero,.panel { background:var(--card); border-radius:24px; padding:24px; box-shadow:0 18px 48px rgba(16,32,48,0.12); }
      .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:18px; margin-top:18px; }
      .metric { padding:18px; border-radius:18px; background:rgba(255,255,255,0.86); }
      pre { white-space:pre-wrap; overflow:auto; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Fluid Rust Server</h1>
        <p>Bundled dashboard served directly from the Rust binary.</p>
      </section>
      <section class="grid">
        <article class="metric"><strong>Runtime</strong><div>Rust + Axum</div></article>
        <article class="metric"><strong>Observability</strong><div>/health /metrics /fee-bump</div></article>
        <article class="metric"><strong>Routes</strong><div>/health /metrics /fee-bump /test/*</div></article>
      </section>
      <section class="panel" style="margin-top:18px">
        <strong>Live Health Snapshot</strong>
        <pre id="output">Loading...</pre>
      </section>
    </main>
    <script>
      fetch('/health').then((r) => r.json()).then((data) => {
        document.getElementById('output').textContent = JSON.stringify(data, null, 2);
      }).catch((error) => {
        document.getElementById('output').textContent = String(error);
      });
    </script>
  </body>
</html>"#;
