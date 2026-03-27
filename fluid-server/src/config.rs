use crate::error::AppError;
use axum::http::StatusCode;

#[derive(Clone, Copy)]
pub enum HorizonSelectionStrategy {
    Priority,
    RoundRobin,
}

#[derive(Clone)]
pub struct Config {
    pub allowed_origins: Vec<String>,
    pub base_fee: i64,
    pub fee_multiplier: f64,
    pub global_rate_limit_max: u32,
    pub global_rate_limit_window_ms: u64,
    pub horizon_selection_strategy: HorizonSelectionStrategy,
    pub horizon_urls: Vec<String>,
    pub network_passphrase: String,
    pub port: u16,
}

pub fn load_config() -> Result<(Config, Vec<String>), AppError> {
    let secrets = parse_csv_env("FLUID_FEE_PAYER_SECRET").ok_or_else(|| {
        AppError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "FLUID_FEE_PAYER_SECRET environment variable is required",
        )
    })?;

    let allowed_origins = parse_csv_env("FLUID_ALLOWED_ORIGINS").unwrap_or_default();
    let base_fee = env_parse("FLUID_BASE_FEE", 100_i64);
    let fee_multiplier = env_parse("FLUID_FEE_MULTIPLIER", 2.0_f64);
    let global_rate_limit_max = env_parse("FLUID_RATE_LIMIT_MAX", 5_u32);
    let global_rate_limit_window_ms = env_parse("FLUID_RATE_LIMIT_WINDOW_MS", 60_000_u64);
    let configured_horizon_urls = parse_csv_env("STELLAR_HORIZON_URLS").unwrap_or_default();
    let legacy_horizon_url = std::env::var("STELLAR_HORIZON_URL").ok();
    let horizon_urls = if configured_horizon_urls.is_empty() {
        legacy_horizon_url
            .into_iter()
            .filter(|value| !value.trim().is_empty())
            .collect()
    } else {
        configured_horizon_urls
    };
    let horizon_selection_strategy = match std::env::var("FLUID_HORIZON_SELECTION")
        .unwrap_or_else(|_| "priority".to_string())
        .as_str()
    {
        "round_robin" => HorizonSelectionStrategy::RoundRobin,
        _ => HorizonSelectionStrategy::Priority,
    };
    let network_passphrase = std::env::var("STELLAR_NETWORK_PASSPHRASE")
        .unwrap_or_else(|_| "Test SDF Network ; September 2015".to_string());
    let port = env_parse("PORT", 3000_u16);

    Ok((
        Config {
            allowed_origins,
            base_fee,
            fee_multiplier,
            global_rate_limit_max,
            global_rate_limit_window_ms,
            horizon_selection_strategy,
            horizon_urls,
            network_passphrase,
            port,
        },
        secrets,
    ))
}

fn env_parse<T>(key: &str, default: T) -> T
where
    T: std::str::FromStr,
{
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn parse_csv_env(key: &str) -> Option<Vec<String>> {
    std::env::var(key).ok().map(|value| {
        value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn unique_key(suffix: &str) -> String {
        format!("FLUID_TEST_{suffix}_{}", uuid::Uuid::new_v4())
    }

    #[test]
    fn parse_csv_env_splits_trims_and_filters() {
        let _lock = ENV_LOCK.lock().unwrap();
        let key = unique_key("CSV");
        std::env::set_var(&key, " a, ,b,  c  ,,");
        let value = parse_csv_env(&key).unwrap();
        assert_eq!(value, vec!["a", "b", "c"]);
        std::env::remove_var(&key);
    }

    #[test]
    fn env_parse_returns_default_on_missing_or_invalid() {
        let _lock = ENV_LOCK.lock().unwrap();
        let missing = unique_key("MISSING");
        let value: u32 = env_parse(&missing, 42);
        assert_eq!(value, 42);

        let invalid = unique_key("INVALID");
        std::env::set_var(&invalid, "not-a-number");
        let value: u32 = env_parse(&invalid, 7);
        assert_eq!(value, 7);
        std::env::remove_var(&invalid);
    }

    #[test]
    fn load_config_errors_when_fee_payer_secret_missing() {
        let _lock = ENV_LOCK.lock().unwrap();
        // Ensure the required secret isn't set for this test process.
        std::env::remove_var("FLUID_FEE_PAYER_SECRET");
        match load_config() {
            Ok(_) => panic!("expected missing secret to error"),
            Err(err) => {
                assert_eq!(err.code, "INTERNAL_ERROR");
                assert_eq!(err.status, StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    }

    #[test]
    fn load_config_happy_path_parses_env_and_defaults() {
        let _lock = ENV_LOCK.lock().unwrap();
        // Required
        std::env::set_var("FLUID_FEE_PAYER_SECRET", "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

        // Optional, but set to exercise parsing.
        std::env::set_var("FLUID_ALLOWED_ORIGINS", "https://a.example, https://b.example");
        std::env::set_var("FLUID_BASE_FEE", "150");
        std::env::set_var("FLUID_FEE_MULTIPLIER", "1.5");
        std::env::set_var("FLUID_RATE_LIMIT_MAX", "9");
        std::env::set_var("FLUID_RATE_LIMIT_WINDOW_MS", "120000");
        std::env::set_var("STELLAR_NETWORK_PASSPHRASE", "Test Network");
        std::env::set_var("PORT", "4242");

        // Horizon selection: configured list takes priority over legacy var.
        std::env::set_var("STELLAR_HORIZON_URL", "https://legacy.example");
        std::env::set_var("STELLAR_HORIZON_URLS", "https://h1.example,https://h2.example");
        std::env::set_var("FLUID_HORIZON_SELECTION", "round_robin");

        let (config, secrets) = load_config().expect("expected config to load");
        assert_eq!(secrets.len(), 1);
        assert_eq!(config.allowed_origins, vec!["https://a.example", "https://b.example"]);
        assert_eq!(config.base_fee, 150);
        assert!((config.fee_multiplier - 1.5).abs() < f64::EPSILON);
        assert_eq!(config.global_rate_limit_max, 9);
        assert_eq!(config.global_rate_limit_window_ms, 120_000);
        assert_eq!(config.network_passphrase, "Test Network");
        assert_eq!(config.port, 4242);
        assert_eq!(config.horizon_urls, vec!["https://h1.example", "https://h2.example"]);
        assert!(matches!(
            config.horizon_selection_strategy,
            HorizonSelectionStrategy::RoundRobin
        ));

        std::env::remove_var("FLUID_FEE_PAYER_SECRET");
        std::env::remove_var("FLUID_ALLOWED_ORIGINS");
        std::env::remove_var("FLUID_BASE_FEE");
        std::env::remove_var("FLUID_FEE_MULTIPLIER");
        std::env::remove_var("FLUID_RATE_LIMIT_MAX");
        std::env::remove_var("FLUID_RATE_LIMIT_WINDOW_MS");
        std::env::remove_var("STELLAR_NETWORK_PASSPHRASE");
        std::env::remove_var("PORT");
        std::env::remove_var("STELLAR_HORIZON_URL");
        std::env::remove_var("STELLAR_HORIZON_URLS");
        std::env::remove_var("FLUID_HORIZON_SELECTION");
    }

    #[test]
    fn load_config_uses_legacy_horizon_url_when_list_empty() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("FLUID_FEE_PAYER_SECRET", "SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
        std::env::remove_var("STELLAR_HORIZON_URLS");
        std::env::set_var("STELLAR_HORIZON_URL", "https://legacy.example");
        std::env::set_var("FLUID_HORIZON_SELECTION", "priority");

        let (config, _) = load_config().expect("expected config to load");
        assert_eq!(config.horizon_urls, vec!["https://legacy.example"]);
        assert!(matches!(
            config.horizon_selection_strategy,
            HorizonSelectionStrategy::Priority
        ));

        std::env::remove_var("FLUID_FEE_PAYER_SECRET");
        std::env::remove_var("STELLAR_HORIZON_URL");
        std::env::remove_var("FLUID_HORIZON_SELECTION");
    }
}
