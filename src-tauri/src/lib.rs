mod commands;
mod config;
mod db;
mod gateway;

use gateway::{GatewayState, SharedGatewayState};
use parking_lot::Mutex;
use std::sync::Arc;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent,
};

fn make_tray_icon_rgba(color: [u8; 4]) -> tauri::image::Image<'static> {
    let size = 32u32;
    let pixel_count = (size * size) as usize;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for _ in 0..pixel_count {
        rgba.extend_from_slice(&color);
    }
    tauri::image::Image::new_owned(rgba, size, size)
}

fn green_icon() -> tauri::image::Image<'static> {
    make_tray_icon_rgba([24, 160, 88, 255])
}

fn gray_icon() -> tauri::image::Image<'static> {
    make_tray_icon_rgba([107, 114, 128, 255])
}

fn update_tray(app: &tauri::AppHandle, running: bool) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };

    if running {
        let _ = tray.set_icon(Some(green_icon()));
        let _ = tray.set_tooltip(Some("SwitchAI Gateway - Running"));
    } else {
        let _ = tray.set_icon(Some(gray_icon()));
        let _ = tray.set_tooltip(Some("SwitchAI Gateway - Stopped"));
    }

    let start_item = MenuItemBuilder::with_id("start", "Start Gateway")
        .enabled(!running)
        .build(app);
    let stop_item = MenuItemBuilder::with_id("stop", "Stop Gateway")
        .enabled(running)
        .build(app);
    let show_item = MenuItemBuilder::with_id("show", "Show Window")
        .build(app);

    let (Ok(s), Ok(t), Ok(sh)) = (&start_item, &stop_item, &show_item) else {
        tracing::error!("Failed to build tray menu items");
        return;
    };

    let Ok(menu) = MenuBuilder::new(app)
        .item(s)
        .item(t)
        .separator()
        .item(sh)
        .separator()
        .quit()
        .build()
    else {
        tracing::error!("Failed to build tray menu");
        return;
    };

    let _ = tray.set_menu(Some(menu));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("RUST_BACKTRACE", "full");

    std::panic::set_hook(Box::new(|info| {
        let msg = match (
            info.payload().downcast_ref::<&str>(),
            info.payload().downcast_ref::<String>(),
        ) {
            (Some(s), _) => s.to_string(),
            (_, Some(s)) => s.clone(),
            _ => "unknown panic".to_string(),
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let crash_entry = format!(
            "=== PANIC {} ===\nthread: {:?}\nlocation: {}\nmessage: {}\n\nbacktrace:\n{}\n\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            std::thread::current().name().unwrap_or("<unnamed>"),
            location,
            msg,
            backtrace,
        );
        eprintln!("{}", crash_entry);
         let crash_path = std::env::current_dir()
             .unwrap_or_else(|_| std::path::PathBuf::from("."))
             .join("crash.log");
         let _ = std::fs::OpenOptions::new()
             .create(true)
             .append(true)
             .open(&crash_path)
             .and_then(|mut f| {
                 use std::io::Write;
                 f.write_all(crash_entry.as_bytes())
             });
         std::process::abort();
    }));

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let run_log_dir = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let file_appender = tracing_appender::rolling::never(&run_log_dir, "run.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    Box::leak(Box::new(_guard));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::Layer::new().with_writer(std::io::stdout))
        .with(fmt::Layer::new().with_writer(non_blocking))
        .init();

    let db_conn = db::init_db().unwrap_or_else(|e| {
        tracing::error!("Fatal: Failed to initialize database: {}", e);
        eprintln!("Fatal: Failed to initialize database: {}", e);
        std::process::exit(1);
    });
    db::acquire_instance_lock(&db_conn).unwrap_or_else(|e| {
        tracing::error!("{}", e);
        eprintln!("{}", e);
        std::process::exit(1);
    });

    let config = db::load_config(&db_conn)
        .unwrap_or_else(|e| {
            tracing::warn!("Failed to load config from DB, using default: {}", e);
            None
        })
        .unwrap_or_default();

    let db_shared = Arc::new(Mutex::new(db_conn));

    if config.server.log_retention_days > 0 {
        if let Err(e) = db::cleanup_expired_logs(&db_shared.lock(), config.server.log_retention_days) {
            tracing::warn!("Failed to cleanup expired logs: {}", e);
        }
    }

    let launched_hidden = config.auto_start;

    let gateway_state: SharedGatewayState =
        Arc::new(Mutex::new(GatewayState::new(config.clone(), db_shared.clone())));
    let gateway_for_shutdown = gateway_state.clone();
    let db_for_shutdown = db_shared.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(gateway_state.clone())
        .manage(db_shared.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let build_tray = || -> Result<(), Box<dyn std::error::Error>> {
                let start = MenuItemBuilder::with_id("start", "Start Gateway")
                    .enabled(true)
                    .build(app)?;
                let stop = MenuItemBuilder::with_id("stop", "Stop Gateway")
                    .enabled(false)
                    .build(app)?;
                let show = MenuItemBuilder::with_id("show", "Show Window")
                    .build(app)?;

                let menu = MenuBuilder::new(app)
                    .item(&start)
                    .item(&stop)
                    .separator()
                    .item(&show)
                    .separator()
                    .quit()
                    .build()?;

                TrayIconBuilder::new()
                    .icon(gray_icon())
                    .menu(&menu)
                    .tooltip("SwitchAI Gateway - Stopped")
                    .on_menu_event({
                        let gw_state = gateway_state.clone();
                        let handle = app_handle.clone();
                        move |app, event| {
                            let running = {
                                let gw = gw_state.lock();
                                gw.is_running()
                            };
                            match event.id().as_ref() {
                                "start" if !running => {
                                    let gw = gw_state.clone();
                                    let h = handle.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if let Err(e) =
                                            crate::commands::gateway::start_gateway_inner(&gw).await
                                        {
                                            tracing::error!("Tray start gateway failed: {}", e);
                                        }
                                        let running = gw.lock().is_running();
                                        crate::commands::gateway::update_last_gateway_state(running);
                                        update_tray(&h, running);
                                    });
                                }
                                "stop" if running => {
                                    let gw = gw_state.clone();
                                    let h = handle.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if let Err(e) =
                                            crate::commands::gateway::stop_gateway_inner(&gw).await
                                        {
                                            tracing::error!("Tray stop gateway failed: {}", e);
                                        }
                                        crate::commands::gateway::update_last_gateway_state(false);
                                        update_tray(&h, false);
                                    });
                                }
                                "show" => {
                                    if let Some(window) = app.get_webview_window("main") {
                                        if window.is_visible().unwrap_or(false) {
                                            let _ = window.set_focus();
                                        } else {
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;

                Ok(())
            };

            if let Err(e) = build_tray() {
                tracing::error!("Failed to build system tray: {}", e);
            }

            if launched_hidden {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            if config.gateway_on_startup && config.last_gateway_state {
                let gw = gateway_state.clone();
                let h = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = crate::commands::gateway::start_gateway_inner(&gw).await {
                        tracing::warn!("Auto-start gateway failed: {}", e);
                    }
                    let running = gw.lock().is_running();
                    crate::commands::gateway::update_last_gateway_state(running);
                    update_tray(&h, running);
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::get_config,
            commands::config::save_config,
            commands::config::add_provider,
            commands::config::update_provider,
            commands::config::delete_provider,
            commands::config::test_provider,
            commands::config::test_provider_direct,
            commands::gateway::start_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::gateway_status,
            commands::stats::get_logs,
            commands::stats::get_stats,
            commands::stats::export_logs,
            commands::stats::get_daily_stats,
            commands::stats::clear_logs,
        ])
        .build(tauri::generate_context!());

    let app = match builder {
        Ok(app) => app,
        Err(e) => {
            tracing::error!("Fatal: Failed to build Tauri application: {}", e);
            eprintln!("Fatal: Failed to build Tauri application: {}", e);
            std::process::exit(1);
        }
    };

    app.run(move |_app, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            let gw = gateway_for_shutdown.clone();
            tauri::async_runtime::block_on(async {
                if let Err(e) = crate::commands::gateway::stop_gateway_inner(&gw).await {
                    tracing::warn!("Graceful shutdown - stop gateway failed: {}", e);
                } else {
                    tracing::info!("Gateway stopped gracefully on exit");
                }
            });
            {
                let conn = db_for_shutdown.lock();
                let _ = db::release_instance_lock(&conn);
            }
        }
    });
}
