use crate::db;
use crate::gateway::types::{DailyStats, PaginatedLogs, StatsSummary, LogFilter};
use parking_lot::Mutex;
use rusqlite::Connection;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_logs(
    page: usize,
    page_size: usize,
    filter: Option<LogFilter>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<PaginatedLogs, String> {
    let conn = db.lock();
    let page_i64 = page as i64;
    let page_size_i64 = page_size as i64;
    let model_filter = filter.as_ref().and_then(|f| f.model.as_deref());
    let success_filter = filter.as_ref().and_then(|f| f.success);
    let result = db::query_logs(&conn, page_i64, page_size_i64, model_filter, success_filter)?;
    Ok(PaginatedLogs {
        logs: result.logs,
        total: result.total as usize,
        page,
        page_size,
    })
}

#[tauri::command]
pub fn clear_logs(
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<u64, String> {
    let conn = db.lock();
    db::clear_logs(&conn)
}

#[tauri::command]
pub fn get_stats(
    days: Option<u32>,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<StatsSummary, String> {
    let conn = db.lock();
    let config = match crate::db::load_config(&conn) {
        Ok(Some(c)) => c,
        Ok(None) => Default::default(),
        Err(e) => {
            tracing::warn!("Failed to load config in get_stats: {}, using defaults", e);
            Default::default()
        }
    };
    let input_price = config.server.token_price_per_1k;
    let output_price = config.server.token_price_per_1k;
    let mut summary = db::get_stats(&conn, days.map(|d| d as i32))?;
    summary.total_cost = (summary.total_input_tokens as f64 * input_price / 1000.0)
        + (summary.total_output_tokens as f64 * output_price / 1000.0);
    summary.input_cost = summary.total_input_tokens as f64 * input_price / 1000.0;
    summary.output_cost = summary.total_output_tokens as f64 * output_price / 1000.0;
    Ok(summary)
}

#[tauri::command]
pub fn get_daily_stats(
    days: u32,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<Vec<DailyStats>, String> {
    let conn = db.lock();
    let stats = db::get_daily_stats(&conn, days as i32)?;
    Ok(stats
        .into_iter()
        .map(|s| DailyStats {
            date: s.date,
            requests: s.requests as u64,
            input_tokens: s.input_tokens as u64,
            output_tokens: s.output_tokens as u64,
            tokens: s.input_tokens as u64 + s.output_tokens as u64,
        })
        .collect())
}

#[tauri::command]
pub fn export_logs(
    format: String,
    db: State<'_, Arc<Mutex<Connection>>>,
) -> Result<String, String> {
    let conn = db.lock();
    match format.as_str() {
        "json" => db::export_logs_json(&conn),
        "csv" => db::export_logs_csv(&conn),
        _ => Err(format!("Unsupported format: {}", format)),
    }
}
