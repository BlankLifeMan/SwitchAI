use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, AeadCore, Key, Nonce,
};
use base64::Engine;
use chrono::Utc;
use rand::RngCore;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use crate::gateway::types::{Config, RequestLog, StatsSummary, ModelStats};

pub fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".switchai").join("switchai.db")
}

fn key_file_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".switchai").join(".dbkey")
}

fn get_or_create_encryption_key() -> Result<Key<Aes256Gcm>, String> {
    let path = key_file_path();
    if path.exists() {
        let raw = std::fs::read(&path).map_err(|e| format!("Failed to read key file: {}", e))?;
        if raw.len() != 32 {
            return Err("Invalid key file length".to_string());
        }
        let key = Key::<Aes256Gcm>::from_slice(&raw);
        return Ok(key.clone());
    }
    let dir = path.parent().unwrap();
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create dir: {}", e))?;
    let mut raw = [0u8; 32];
    OsRng.fill_bytes(&mut raw);
    std::fs::write(&path, &raw).map_err(|e| format!("Failed to write key file: {}", e))?;
    let key = Key::<Aes256Gcm>::from_slice(&raw);
    Ok(key.clone())
}

fn encrypt(key: &Key<Aes256Gcm>, plaintext: &str) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;
    Ok((ciphertext, nonce.to_vec()))
}

fn decrypt(key: &Key<Aes256Gcm>, ciphertext: &[u8], nonce: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
}

const SCHEMA_VERSION: i32 = 4;

pub fn init_db() -> Result<Connection, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create db dir: {}", e))?;
    }

    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS _meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS config (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            data       TEXT    NOT NULL,
            version    INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS config_history (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            version    INTEGER NOT NULL,
            data       TEXT    NOT NULL,
            created_at TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS api_keys (
            provider_id   TEXT PRIMARY KEY,
            encrypted_key BLOB NOT NULL,
            nonce         BLOB NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS request_logs (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp    TEXT    NOT NULL,
            model        TEXT    NOT NULL,
            provider     TEXT    NOT NULL,
            status_code  INTEGER NOT NULL,
            input_tokens INTEGER,
            output_tokens INTEGER,
            duration_ms  INTEGER NOT NULL,
            success      INTEGER NOT NULL DEFAULT 1,
            error_message TEXT,
            is_streaming INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_logs_ts      ON request_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_model   ON request_logs(model);
        CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider);
        CREATE INDEX IF NOT EXISTS idx_logs_success  ON request_logs(success);

        CREATE TABLE IF NOT EXISTS instance_lock (
            id        INTEGER PRIMARY KEY CHECK (id = 1),
            pid       INTEGER NOT NULL,
            hostname  TEXT    NOT NULL,
            locked_at TEXT    NOT NULL
        );
        ",
    )
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM _meta WHERE key='schema_version'), 0)",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version < SCHEMA_VERSION {
        migrate(&conn, current_version, SCHEMA_VERSION)?;
        conn.execute(
            "INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )
        .map_err(|e| format!("Failed to update schema version: {}", e))?;
    }

    if let Err(e) = migrate_from_yaml(&conn) {
        tracing::warn!("YAML migration skipped: {}", e);
    }

    Ok(conn)
}

fn migrate(conn: &Connection, from: i32, to: i32) -> Result<(), String> {
    for v in (from + 1)..=to {
        match v {
            1 => {
                conn.execute_batch(
                    "INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '1');",
                )
                .map_err(|e| format!("Migration v1 failed: {}", e))?;
            }
            2 => {
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN input_tokens INTEGER;",
                )
                .ok();
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN output_tokens INTEGER;",
                )
                .ok();
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN is_streaming INTEGER NOT NULL DEFAULT 0;",
                )
                .ok();
            }
            3 => {
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN request_body TEXT;",
                )
                .ok();
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN response_body TEXT;",
                )
                .ok();
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN endpoint TEXT;",
                )
                .ok();
                conn.execute_batch(
                    "ALTER TABLE request_logs ADD COLUMN request_headers TEXT;",
                )
                .ok();
            }
            4 => {
                conn.execute_batch(
                    "CREATE INDEX IF NOT EXISTS idx_logs_ts ON request_logs(timestamp);",
                )
                .ok();
                conn.execute_batch(
                    "CREATE INDEX IF NOT EXISTS idx_logs_model ON request_logs(model);",
                )
                .ok();
                conn.execute_batch(
                    "CREATE INDEX IF NOT EXISTS idx_logs_provider ON request_logs(provider);",
                )
                .ok();
                conn.execute_batch(
                    "CREATE INDEX IF NOT EXISTS idx_logs_success ON request_logs(success);",
                )
                .ok();
            }
            _ => {}
        }
    }
    Ok(())
}

fn yaml_config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".switchai").join("config.yaml")
}

fn yaml_keys_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".switchai").join("keys")
}

fn migrate_from_yaml(conn: &Connection) -> Result<(), String> {
    let yaml_path = yaml_config_path();
    if !yaml_path.exists() {
        return Err("config.yaml not found".to_string());
    }

    let config_exists: bool = conn
        .query_row("SELECT COUNT(*) FROM config WHERE id=1", [], |r| r.get::<_, i32>(0))
        .map(|c| c > 0)
        .unwrap_or(false);
    if config_exists {
        return Err("SQLite config already exists, skipping migration".to_string());
    }

    let yaml_str =
        std::fs::read_to_string(&yaml_path).map_err(|e| format!("Failed to read {}: {}", yaml_path.display(), e))?;
    let config: Config = serde_yaml::from_str(&yaml_str)
        .map_err(|e| format!("Failed to parse config.yaml: {}", e))?;

    save_config(conn, &config, true).map_err(|e| format!("Failed to save config: {}", e))?;

    let keys_dir = yaml_keys_dir();
    let mut migrated_keys = 0usize;
    for provider in &config.providers {
        let key: Option<String> = if let Some(ref key_ref) = provider.api_key_ref {
            let key_file = keys_dir.join(key_ref);
            if key_file.exists() {
                match std::fs::read_to_string(&key_file) {
                    Ok(encoded) => {
                        let trimmed = encoded.trim();
                        match base64::engine::general_purpose::STANDARD.decode(trimmed) {
                            Ok(decoded) => match String::from_utf8(decoded) {
                                Ok(s) => Some(s),
                                Err(_) => None,
                            },
                            Err(_) => None,
                        }
                    }
                    Err(_) => None,
                }
            } else {
                None
            }
        } else {
            None
        };

        let key = match key {
            Some(k) => k,
            None => {
                match keyring::Entry::new("switchai", &provider.id) {
                    Ok(entry) => match entry.get_password() {
                        Ok(k) => k,
                        Err(_) => continue,
                    },
                    Err(_) => continue,
                }
            }
        };

        match store_api_key(conn, &provider.id, &key) {
            Ok(()) => {
                migrated_keys += 1;
                tracing::info!("Migrated API key for provider '{}'", provider.id);
            }
            Err(e) => {
                tracing::warn!("Failed to store API key for provider '{}': {}", provider.id, e);
            }
        }
    }

    tracing::info!(
        "YAML migration complete: {} providers, {} API keys migrated",
        config.providers.len(),
        migrated_keys
    );
    Ok(())
}

pub fn acquire_instance_lock(conn: &Connection) -> Result<(), String> {
    let pid = std::process::id();
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    let now = Utc::now().to_rfc3339();

    let existing: Option<(i32, String, String)> = conn
        .query_row(
            "SELECT pid, hostname, locked_at FROM instance_lock WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    if let Some((old_pid, old_host, old_time)) = existing {
        let is_alive = is_process_alive(old_pid as u32);
        if is_alive && old_pid != pid as i32 {
            return Err(format!(
                "Another SwitchAI instance is already running (PID: {}, host: {}, since: {})",
                old_pid, old_host, old_time
            ));
        }
    }

    conn.execute(
        "INSERT OR REPLACE INTO instance_lock (id, pid, hostname, locked_at) VALUES (1, ?1, ?2, ?3)",
        params![pid as i32, hostname, now],
    )
    .map_err(|e| format!("Failed to acquire instance lock: {}", e))?;

    Ok(())
}

pub fn release_instance_lock(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM instance_lock WHERE id=1", [])
        .map_err(|e| format!("Failed to release lock: {}", e))?;
    Ok(())
}

pub fn load_config(conn: &Connection) -> Result<Option<Config>, String> {
    let row = conn.query_row(
        "SELECT data FROM config WHERE id=1",
        [],
        |row| row.get::<_, String>(0),
    );
    match row {
        Ok(data) => {
            let config: Config = serde_json::from_str(&data)
                .map_err(|e| format!("Failed to parse config: {}", e))?;
            Ok(Some(config))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to load config: {}", e)),
    }
}

pub fn save_config(conn: &Connection, config: &Config, save_history: bool) -> Result<(), String> {
    let data = serde_json::to_string(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    let now = Utc::now().to_rfc3339();

    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM (SELECT version FROM config WHERE id=1 UNION ALL SELECT 0)",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let new_version = current_version + 1;

    if save_history && current_version > 0 {
        conn.execute(
            "INSERT INTO config_history (version, data, created_at) VALUES (?1, ?2, ?3)",
            params![current_version, data, now],
        )
        .map_err(|e| format!("Failed to save config history: {}", e))?;

        conn.execute(
            "DELETE FROM config_history WHERE id NOT IN (SELECT id FROM config_history ORDER BY id DESC LIMIT 50)",
            [],
        )
        .map_err(|e| format!("Failed to prune history: {}", e))?;
    }

    conn.execute(
        "INSERT OR REPLACE INTO config (id, data, version, updated_at) VALUES (1, ?1, ?2, ?3)",
        params![data, new_version, now],
    )
    .map_err(|e| format!("Failed to save config: {}", e))?;

    Ok(())
}

pub fn get_config_history(conn: &Connection, limit: i32) -> Result<Vec<(i32, String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT version, data, created_at FROM config_history ORDER BY id DESC LIMIT ?1")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| format!("{}", e))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(result)
}

pub fn rollback_config(conn: &Connection, target_version: i32) -> Result<Config, String> {
    let data: String = conn
        .query_row(
            "SELECT data FROM config_history WHERE version=?1",
            params![target_version],
            |row| row.get(0),
        )
        .map_err(|e| format!("Version {} not found: {}", target_version, e))?;
    let config: Config = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse config: {}", e))?;
    save_config(conn, &config, false)?;
    Ok(config)
}

pub fn store_api_key(conn: &Connection, provider_id: &str, api_key: &str) -> Result<(), String> {
    let key = get_or_create_encryption_key()?;
    let (ciphertext, nonce) = encrypt(&key, api_key)?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO api_keys (provider_id, encrypted_key, nonce, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![provider_id, ciphertext, nonce, now],
    )
    .map_err(|e| format!("Failed to store API key: {}", e))?;
    Ok(())
}

pub fn get_api_key(conn: &Connection, provider_id: &str) -> Result<Option<String>, String> {
    let row = conn.query_row(
        "SELECT encrypted_key, nonce FROM api_keys WHERE provider_id=?1",
        params![provider_id],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
    );
    match row {
        Ok((ciphertext, nonce)) => {
            let key = get_or_create_encryption_key()?;
            let plaintext = decrypt(&key, &ciphertext, &nonce)?;
            Ok(Some(plaintext))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get API key: {}", e)),
    }
}

pub fn delete_api_key(conn: &Connection, provider_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM api_keys WHERE provider_id=?1",
        params![provider_id],
    )
    .map_err(|e| format!("Failed to delete API key: {}", e))?;
    Ok(())
}

pub fn add_log(conn: &Connection, log: &RequestLog) -> Result<(), String> {
    conn.execute(
        "INSERT INTO request_logs (timestamp, model, provider, status_code, input_tokens, output_tokens, duration_ms, success, error_message, is_streaming, request_body, response_body, endpoint, request_headers)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        params![
            log.timestamp.to_rfc3339(),
            log.model,
            log.provider,
            log.status_code as i32,
            log.input_tokens.map(|t| t as i32),
            log.output_tokens.map(|t| t as i32),
            log.duration_ms as i32,
            if log.success { 1 } else { 0 },
            log.error_message,
            if log.is_streaming { 1 } else { 0 },
            log.request_body,
            log.response_body,
            log.endpoint,
            log.request_headers,
        ],
    )
    .map_err(|e| format!("Failed to add log: {}", e))?;
    Ok(())
}

pub struct LogPage {
    pub logs: Vec<RequestLog>,
    pub total: i64,
}

pub fn query_logs(
    conn: &Connection,
    page: i64,
    page_size: i64,
    model_filter: Option<&str>,
    success_filter: Option<bool>,
) -> Result<LogPage, String> {
    let mut where_clauses = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(m) = model_filter {
        if !m.is_empty() {
            where_clauses.push(format!("model LIKE ?{}", param_values.len() + 1));
            param_values.push(Box::new(format!("%{}%", m)));
        }
    }
    if let Some(s) = success_filter {
        where_clauses.push(format!("success = ?{}", param_values.len() + 1));
        param_values.push(Box::new(if s { 1 } else { 0 }));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let count_sql = format!("SELECT COUNT(*) FROM request_logs {}", where_sql);
    let total: i64 = {
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
        conn.query_row(&count_sql, params_refs.as_slice(), |row| row.get(0))
            .unwrap_or(0)
    };

    let offset = (page - 1).max(0) * page_size;
    let query_sql = format!(
        "SELECT timestamp, model, provider, status_code, input_tokens, output_tokens, duration_ms, success, error_message, is_streaming, request_body, response_body, endpoint, request_headers
         FROM request_logs {} ORDER BY id DESC LIMIT ?{} OFFSET ?{}",
        where_sql,
        param_values.len() + 1,
        param_values.len() + 2,
    );

    param_values.push(Box::new(page_size));
    param_values.push(Box::new(offset));

    let mut stmt = conn.prepare(&query_sql).map_err(|e| format!("{}", e))?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(RequestLog {
                timestamp: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(0)?)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| Utc::now()),
                model: row.get(1)?,
                provider: row.get(2)?,
                status_code: row.get::<_, i32>(3)? as u16,
                input_tokens: row.get::<_, Option<i32>>(4)?.map(|t| t as u32),
                output_tokens: row.get::<_, Option<i32>>(5)?.map(|t| t as u32),
                duration_ms: row.get::<_, i32>(6)? as u64,
                success: row.get::<_, i32>(7)? != 0,
                error_message: row.get(8)?,
                is_streaming: row.get::<_, i32>(9)? != 0,
                request_body: row.get(10)?,
                response_body: row.get(11)?,
                endpoint: row.get(12)?,
                request_headers: row.get(13)?,
            })
        })
        .map_err(|e| format!("{}", e))?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row.map_err(|e| format!("{}", e))?);
    }

    Ok(LogPage { logs, total })
}

pub fn clear_logs(conn: &Connection) -> Result<u64, String> {
    let deleted = conn
        .execute("DELETE FROM request_logs", [])
        .map_err(|e| format!("Failed to clear logs: {}", e))?;
    Ok(deleted as u64)
}

pub fn cleanup_expired_logs(conn: &Connection, retention_days: u32) -> Result<u64, String> {
    if retention_days == 0 {
        return Ok(0);
    }
    let cutoff = Utc::now() - chrono::Duration::days(retention_days as i64);
    let deleted = conn
        .execute(
            "DELETE FROM request_logs WHERE timestamp < ?1",
            params![cutoff.to_rfc3339()],
        )
        .map_err(|e| format!("Failed to cleanup expired logs: {}", e))?;
    Ok(deleted as u64)
}

pub fn get_stats(conn: &Connection, days: Option<i32>) -> Result<StatsSummary, String> {
    let (total_requests, total_input_tokens, total_output_tokens, success_count, fail_count) =
        match days {
            Some(d) => conn
                .query_row(
                    "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
                            COALESCE(SUM(CASE WHEN success=1 THEN 1 ELSE 0 END),0),
                            COALESCE(SUM(CASE WHEN success=0 THEN 1 ELSE 0 END),0)
                     FROM request_logs WHERE timestamp >= datetime('now', '-' || ? || ' days')",
                    rusqlite::params![d],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .unwrap_or((0, 0, 0, 0, 0)),
            None => conn
                .query_row(
                    "SELECT COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0),
                            COALESCE(SUM(CASE WHEN success=1 THEN 1 ELSE 0 END),0),
                            COALESCE(SUM(CASE WHEN success=0 THEN 1 ELSE 0 END),0)
                     FROM request_logs",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                        ))
                    },
                )
                .unwrap_or((0, 0, 0, 0, 0)),
        };

    let by_model: Vec<ModelStats> = match days {
        Some(d) => {
            let mut stmt = conn
                .prepare("SELECT model, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM request_logs WHERE timestamp >= datetime('now', '-' || ? || ' days') GROUP BY model")
                .map_err(|e| format!("Failed to prepare model stats: {}", e))?;
            let rows: Vec<ModelStats> = stmt
                .query_map(rusqlite::params![d], |row| {
                    Ok(ModelStats {
                        model: row.get(0)?,
                        requests: row.get::<_, i64>(1)? as u64,
                        input_tokens: row.get::<_, i64>(2)? as u64,
                        output_tokens: row.get::<_, i64>(3)? as u64,
                    })
                })
                .map_err(|e| format!("{}", e))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
        None => {
            let mut stmt = conn
                .prepare("SELECT model, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM request_logs GROUP BY model")
                .map_err(|e| format!("Failed to prepare model stats: {}", e))?;
            let rows: Vec<ModelStats> = stmt
                .query_map([], |row| {
                    Ok(ModelStats {
                        model: row.get(0)?,
                        requests: row.get::<_, i64>(1)? as u64,
                        input_tokens: row.get::<_, i64>(2)? as u64,
                        output_tokens: row.get::<_, i64>(3)? as u64,
                    })
                })
                .map_err(|e| format!("{}", e))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        }
    };

    Ok(StatsSummary {
        total_requests: total_requests as u64,
        successful_requests: success_count as u64,
        failed_requests: fail_count as u64,
        total_input_tokens: total_input_tokens as u64,
        total_output_tokens: total_output_tokens as u64,
        total_cost: 0.0,
        input_cost: 0.0,
        output_cost: 0.0,
        by_model,
    })
}

pub struct DailyStat {
    pub date: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
}

pub fn get_daily_stats(conn: &Connection, days: i32) -> Result<Vec<DailyStat>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DATE(timestamp) as d, COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)
             FROM request_logs
             WHERE timestamp >= DATE('now', ?1)
             GROUP BY d ORDER BY d ASC",
        )
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map(params![format!("-{} days", days)], |row| {
            Ok(DailyStat {
                date: row.get(0)?,
                requests: row.get(1)?,
                input_tokens: row.get(2)?,
                output_tokens: row.get(3)?,
            })
        })
        .map_err(|e| format!("{}", e))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| format!("{}", e))?);
    }
    Ok(result)
}

pub fn export_logs_json(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT timestamp, model, provider, status_code, input_tokens, output_tokens, duration_ms, success, error_message, is_streaming FROM request_logs ORDER BY id DESC")
        .map_err(|e| format!("{}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "timestamp": row.get::<_, String>(0)?,
                "model": row.get::<_, String>(1)?,
                "provider": row.get::<_, String>(2)?,
                "status_code": row.get::<_, i32>(3)?,
                "input_tokens": row.get::<_, Option<i32>>(4)?,
                "output_tokens": row.get::<_, Option<i32>>(5)?,
                "duration_ms": row.get::<_, i32>(6)?,
                "success": row.get::<_, i32>(7)? != 0,
                "error_message": row.get::<_, Option<String>>(8)?,
                "is_streaming": row.get::<_, i32>(9)? != 0,
            }))
        })
        .map_err(|e| format!("{}", e))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("{}", e))?);
    }
    serde_json::to_string_pretty(&items).map_err(|e| format!("{}", e))
}

pub fn export_logs_csv(conn: &Connection) -> Result<String, String> {
    let mut stmt = conn
        .prepare("SELECT timestamp, model, provider, status_code, input_tokens, output_tokens, duration_ms, success, error_message, is_streaming FROM request_logs ORDER BY id DESC")
        .map_err(|e| format!("{}", e))?;
    let mut csv = String::from("timestamp,model,provider,status_code,input_tokens,output_tokens,duration_ms,success,error_message,is_streaming\n");
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, Option<i32>>(4)?,
                row.get::<_, Option<i32>>(5)?,
                row.get::<_, i32>(6)?,
                row.get::<_, i32>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i32>(9)?,
            ))
        })
        .map_err(|e| format!("{}", e))?;
    for row in rows {
        let (ts, model, provider, sc, it, ot, dur, success, err, stream) =
            row.map_err(|e| format!("{}", e))?;
        csv.push_str(&format!(
            r#""{}","{}","{}",{},{},{},{},{},{},{}\n"#,
            ts,
            model,
            provider,
            sc,
            it.map_or("".to_string(), |v| v.to_string()),
            ot.map_or("".to_string(), |v| v.to_string()),
            dur,
            success,
            err.as_deref().unwrap_or(""),
            stream,
        ));
    }
    Ok(csv)
}

#[cfg(windows)]
extern "system" {
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> isize;
    fn CloseHandle(hObject: isize) -> i32;
    fn WaitForSingleObject(hHandle: isize, dwMilliseconds: u32) -> u32;
}

const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const SYNCHRONIZE: u32 = 0x00100000;
const WAIT_TIMEOUT: u32 = 0x00000102;

#[cfg(windows)]
fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let handle = unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid)
    };
    if handle == 0 || handle == -1 {
        return false;
    }
    let result = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) };
    result == WAIT_TIMEOUT
}

#[cfg(not(windows))]
fn is_process_alive(_pid: u32) -> bool {
    true
}
