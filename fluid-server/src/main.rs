mod db;
mod xdr;
mod sequence_manager;

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{error, info};

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Serialize)]
struct DbVerificationResponse {
    status: &'static str,
    message: String,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

/// Verification endpoint that tests database connectivity and operations
async fn verify_db(
    State(db_pool): State<Arc<sqlx::postgres::PgPool>>,
) -> Json<DbVerificationResponse> {
    // Test 1: Health check query
    match sqlx::query("SELECT 1").execute(db_pool.as_ref()).await {
        Ok(_) => {
            info!("Database health check passed");
        }
        Err(e) => {
            error!("Database health check failed: {}", e);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Database health check failed: {}", e),
            });
        }
    }

    // Test 2: Attempt to read from Tenant table
    match db::TenantRepo::list_all(db_pool.as_ref()).await {
        Ok(tenants) => {
            info!(
                "Successfully queried Tenant table: {} tenants found",
                tenants.len()
            );
        }
        Err(e) => {
            error!("Failed to query Tenant table: {}", e);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Failed to query Tenant table: {}", e),
            });
        }
    }

    // Test 3: Insert a test transaction
    let test_hash = format!("test_{}", uuid::Uuid::new_v4());
    match db::TransactionRepo::insert(db_pool.as_ref(), &test_hash, "pending").await {
        Ok(tx) => {
            info!(
                "Successfully inserted test transaction: hash={}, status={}",
                tx.hash, tx.status
            );
        }
        Err(e) => {
            error!("Failed to insert test transaction: {}", e);
            return Json(DbVerificationResponse {
                status: "error",
                message: format!("Failed to insert transaction: {}", e),
            });
        }
    }

    info!("All database verification tests passed");
    Json(DbVerificationResponse {
        status: "ok",
        message: "Database connectivity and operations verified successfully".to_string(),
    })
}

#[tokio::main]
async fn main() {
    // Load environment variables from .env file
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fluid_server=info".into()),
        )
        .init();

    // Initialize database pool
    let db_pool = match db::create_pool().await {
        Ok(pool) => Arc::new(pool),
        Err(e) => {
            error!("Failed to create database pool: {}", e);
            std::process::exit(1);
        }
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/verify-db", get(verify_db))
        .with_state(db_pool);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Fluid server (Rust) listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
