use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};

const SERVICE_TYPE: &str = "_tunebox._tcp.local.";

#[derive(Clone, Serialize)]
pub struct PeerInfo {
    pub id: String,
    pub name: String,
}

enum Role {
    Idle,
    Controlling(OwnedWriteHalf),
    BeingControlled(OwnedWriteHalf),
}

pub struct NetworkState {
    /// Human-friendly display name, shown to other devices.
    pub device_name: String,
    /// Unique per-process mDNS instance name (device name + PID), so multiple
    /// instances on one machine (e.g. during development) don't mistake each
    /// other for "self", and so genuine hostname collisions between two real
    /// devices can't hide one from the other either.
    pub mdns_instance_name: String,
    role: Mutex<Role>,
    pending_accept: Mutex<Option<oneshot::Sender<bool>>>,
    peers: Mutex<HashMap<String, PeerInfo>>,
    started: Mutex<bool>,
    reader_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl NetworkState {
    pub fn new() -> Self {
        let device_name = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "TuneBox Device".to_string());
        let mdns_instance_name = format!("{}-{}", device_name, std::process::id());
        Self {
            device_name,
            mdns_instance_name,
            role: Mutex::new(Role::Idle),
            pending_accept: Mutex::new(None),
            peers: Mutex::new(HashMap::new()),
            started: Mutex::new(false),
            reader_task: Mutex::new(None),
        }
    }
}

async fn write_line(write: &mut OwnedWriteHalf, value: &Value) -> Result<(), String> {
    let mut s = value.to_string();
    s.push('\n');
    write.write_all(s.as_bytes()).await.map_err(|e| e.to_string())
}

async fn read_json_line<R: AsyncBufRead + Unpin>(reader: &mut R) -> Option<Value> {
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line).await {
            Ok(0) => return None,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                    return Some(v);
                }
            }
            Err(_) => return None,
        }
    }
}

async fn read_json_line_timeout<R: AsyncBufRead + Unpin>(reader: &mut R, dur: Duration) -> Option<Value> {
    tokio::time::timeout(dur, read_json_line(reader)).await.ok().flatten()
}

/// Relays subsequent `command`/`state` lines to the frontend as `event_name`
/// until the peer disconnects or sends `{"type":"disconnect"}`.
async fn handle_established(
    app: AppHandle,
    reader: &mut BufReader<OwnedReadHalf>,
    event_name: &'static str,
) {
    loop {
        let Some(msg) = read_json_line(reader).await else { break };
        match msg.get("type").and_then(Value::as_str) {
            Some("disconnect") => break,
            Some("command") | Some("state") => {
                if let Some(payload) = msg.get("payload") {
                    let _ = app.emit(event_name, payload.clone());
                }
            }
            _ => {}
        }
    }
}

async fn handle_incoming(app: AppHandle, net: Arc<NetworkState>, stream: TcpStream) {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);

    let Some(msg) = read_json_line_timeout(&mut reader, Duration::from_secs(10)).await else {
        return;
    };
    if msg.get("type").and_then(Value::as_str) != Some("connect_request") {
        return;
    }
    let requester_name = msg
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Unknown device")
        .to_string();

    let is_idle = matches!(*net.role.lock().await, Role::Idle);
    if !is_idle {
        let _ = write_line(&mut write_half, &json!({ "type": "connect_declined" })).await;
        return;
    }

    let (tx, rx) = oneshot::channel();
    *net.pending_accept.lock().await = Some(tx);
    let _ = app.emit("network:incoming-request", json!({ "fromName": requester_name }));

    let accepted = matches!(
        tokio::time::timeout(Duration::from_secs(30), rx).await,
        Ok(Ok(true))
    );
    *net.pending_accept.lock().await = None;

    if !accepted {
        let _ = write_line(&mut write_half, &json!({ "type": "connect_declined" })).await;
        return;
    }

    if write_line(&mut write_half, &json!({ "type": "connect_accepted" })).await.is_err() {
        return;
    }

    *net.role.lock().await = Role::BeingControlled(write_half);
    let _ = app.emit("network:controlled-started", json!({ "peer": requester_name }));

    handle_established(app.clone(), &mut reader, "network:command").await;

    *net.role.lock().await = Role::Idle;
    let _ = app.emit("network:peer-disconnected", json!({}));
}

async fn emit_peers(app: &AppHandle, net: &Arc<NetworkState>) {
    let peers: Vec<PeerInfo> = net.peers.lock().await.values().cloned().collect();
    let _ = app.emit("network:peers", peers);
}

#[tauri::command]
pub async fn network_start(
    app: AppHandle,
    net: tauri::State<'_, Arc<NetworkState>>,
) -> Result<(), String> {
    let net = net.inner().clone();
    {
        let mut started = net.started.lock().await;
        if *started {
            return Ok(());
        }
        *started = true;
    }

    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let mdns = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let host_name = format!("{}.local.", net.mdns_instance_name);
    let service_info = ServiceInfo::new(
        SERVICE_TYPE,
        &net.mdns_instance_name,
        &host_name,
        "",
        port,
        &[("app", "tunebox"), ("name", &net.device_name)][..],
    )
    .map_err(|e| e.to_string())?
    .enable_addr_auto();
    mdns.register(service_info).map_err(|e| e.to_string())?;

    let browse_rx = mdns.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;

    {
        let app = app.clone();
        let net = net.clone();
        let own_host = format!("{}.local", net.mdns_instance_name);
        tauri::async_runtime::spawn(async move {
            while let Ok(event) = browse_rx.recv_async().await {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        if info.host.trim_end_matches('.') == own_host {
                            continue;
                        }
                        let Some(ip) = info
                            .addresses
                            .iter()
                            .find(|a| a.is_ipv4())
                            .or_else(|| info.addresses.iter().next())
                            .map(|a| a.to_ip_addr())
                        else {
                            continue;
                        };
                        let addr = SocketAddr::new(ip, info.port);
                        let id = addr.to_string();
                        let instance_key = info
                            .fullname
                            .split('.')
                            .next()
                            .unwrap_or(&info.fullname)
                            .to_string();
                        let name = info
                            .txt_properties
                            .get_property_val_str("name")
                            .unwrap_or(&instance_key)
                            .to_string();
                        net.peers.lock().await.insert(
                            instance_key.clone(),
                            PeerInfo { id, name },
                        );
                        emit_peers(&app, &net).await;
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => {
                        let instance_key = fullname.split('.').next().unwrap_or(&fullname).to_string();
                        net.peers.lock().await.remove(&instance_key);
                        emit_peers(&app, &net).await;
                    }
                    _ => {}
                }
            }
        });
    }

    {
        let app = app.clone();
        let net = net.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else { break };
                let app_c = app.clone();
                let net_c = net.clone();
                let net_store = net.clone();
                let handle = tauri::async_runtime::spawn(async move {
                    handle_incoming(app_c, net_c, stream).await;
                });
                *net_store.reader_task.lock().await = Some(handle);
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn network_connect(
    app: AppHandle,
    net: tauri::State<'_, Arc<NetworkState>>,
    peer_id: String,
) -> Result<(), String> {
    let net = net.inner().clone();
    let addr: SocketAddr = peer_id.parse().map_err(|_| "invalid device address".to_string())?;

    let stream = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(addr))
        .await
        .map_err(|_| "connection timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let (read_half, mut write_half) = stream.into_split();
    write_line(&mut write_half, &json!({ "type": "connect_request", "name": net.device_name })).await?;

    let mut reader = BufReader::new(read_half);
    let response = read_json_line_timeout(&mut reader, Duration::from_secs(30))
        .await
        .ok_or_else(|| "no response from device".to_string())?;

    if response.get("type").and_then(Value::as_str) != Some("connect_accepted") {
        return Err("the other device declined the connection".to_string());
    }

    *net.role.lock().await = Role::Controlling(write_half);

    let app2 = app.clone();
    let net2 = net.clone();
    let net_store = net.clone();
    let handle = tauri::async_runtime::spawn(async move {
        handle_established(app2.clone(), &mut reader, "network:state").await;
        *net2.role.lock().await = Role::Idle;
        let _ = app2.emit("network:peer-disconnected", json!({}));
    });
    *net_store.reader_task.lock().await = Some(handle);

    Ok(())
}

#[tauri::command]
pub async fn network_respond_request(
    net: tauri::State<'_, Arc<NetworkState>>,
    accept: bool,
) -> Result<(), String> {
    let sender = net.pending_accept.lock().await.take();
    match sender {
        Some(tx) => {
            let _ = tx.send(accept);
            Ok(())
        }
        None => Err("no pending connection request".to_string()),
    }
}

#[tauri::command]
pub async fn network_send_command(
    net: tauri::State<'_, Arc<NetworkState>>,
    payload: Value,
) -> Result<(), String> {
    let mut role = net.role.lock().await;
    match &mut *role {
        Role::Controlling(w) => write_line(w, &json!({ "type": "command", "payload": payload })).await,
        _ => Err("not controlling a device".to_string()),
    }
}

#[tauri::command]
pub async fn network_broadcast_state(
    net: tauri::State<'_, Arc<NetworkState>>,
    payload: Value,
) -> Result<(), String> {
    let mut role = net.role.lock().await;
    match &mut *role {
        Role::BeingControlled(w) => write_line(w, &json!({ "type": "state", "payload": payload })).await,
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn network_disconnect(net: tauri::State<'_, Arc<NetworkState>>) -> Result<(), String> {
    if let Some(handle) = net.reader_task.lock().await.take() {
        handle.abort();
    }
    let mut role = net.role.lock().await;
    match &mut *role {
        Role::Controlling(w) | Role::BeingControlled(w) => {
            let _ = write_line(w, &json!({ "type": "disconnect" })).await;
            let _ = w.shutdown().await;
        }
        Role::Idle => {}
    }
    *role = Role::Idle;
    Ok(())
}
