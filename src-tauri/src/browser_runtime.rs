use crate::running_profile_processes_from_processes;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::time::{Duration, Instant};

pub(crate) const CDP_PROBE_TIMEOUT_MS: u64 = 250;
const CDP_LIST_TIMEOUT_MS: u64 = 500;
pub(crate) const CDP_LIST_MAX_BODY_BYTES: usize = 1024 * 1024;
const CDP_NAVIGATE_TIMEOUT_MS: u64 = 1000;

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TabSnapshot {
    pub(crate) target_id: String,
    pub(crate) r#type: String,
    pub(crate) url: String,
    pub(crate) title: String,
    pub(crate) web_socket_debugger_url: Option<String>,
    pub(crate) checked_at: u64,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeTabNavigationResult {
    pub(crate) profile_id: String,
    pub(crate) target_id: String,
    pub(crate) url: String,
    pub(crate) navigated_at: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CdpTargetRaw {
    #[serde(default)]
    pub(crate) id: Option<String>,
    #[serde(default, rename = "type")]
    pub(crate) r#type: Option<String>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default, rename = "webSocketDebuggerUrl")]
    pub(crate) web_socket_debugger_url: Option<String>,
}

pub(crate) fn runtime_tabs_from_processes<'a, I, F>(
    root_path: &Path,
    profile_id: &str,
    process_lines: I,
    mut fetch_tabs: F,
    checked_at: u64,
) -> Result<Vec<TabSnapshot>, String>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u16) -> Result<Vec<CdpTargetRaw>, String>,
{
    let Some(process) = running_profile_processes_from_processes(root_path, process_lines)
        .into_iter()
        .find(|process| process.profile_id == profile_id)
    else {
        return Err("该账号未运行".to_string());
    };

    let Some(port) = process.debug_port else {
        return Err("该账号需要关闭后重新打开以启用 Browser Runtime".to_string());
    };

    let targets = fetch_tabs(port).map_err(|_| "Browser Runtime 不可用".to_string())?;
    Ok(targets
        .into_iter()
        .filter_map(|target| tab_snapshot_from_cdp_target(target, checked_at))
        .collect())
}

pub(crate) fn validate_runtime_navigation_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let parsed =
        url::Url::parse(url).map_err(|_| "请输入有效的 http:// 或 https:// URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host().is_none() {
        return Err("请输入有效的 http:// 或 https:// URL".to_string());
    }

    Ok(url.to_string())
}

pub(crate) fn navigate_runtime_tab_from_processes<'a, I, F, N>(
    root_path: &Path,
    profile_id: &str,
    url: &str,
    process_lines: I,
    mut fetch_tabs: F,
    mut navigate_page: N,
    navigated_at: u64,
) -> Result<RuntimeTabNavigationResult, String>
where
    I: IntoIterator<Item = &'a str>,
    F: FnMut(u16) -> Result<Vec<CdpTargetRaw>, String>,
    N: FnMut(&str, &str) -> Result<(), String>,
{
    let url = validate_runtime_navigation_url(url)?;
    let Some(process) = running_profile_processes_from_processes(root_path, process_lines)
        .into_iter()
        .find(|process| process.profile_id == profile_id)
    else {
        return Err("该账号未运行".to_string());
    };
    let Some(port) = process.debug_port else {
        return Err("该账号需要关闭后重新打开以启用 Browser Runtime".to_string());
    };

    let targets = fetch_tabs(port).map_err(|_| "Browser Runtime 不可用".to_string())?;
    let mut found_page = false;
    let target = targets
        .into_iter()
        .find(|target| {
            if target.r#type.as_deref() != Some("page") {
                return false;
            }
            found_page = true;
            target
                .web_socket_debugger_url
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            if found_page {
                "找到 page 标签页，但都缺少 WebSocket 调试地址".to_string()
            } else {
                "未找到可导航的 page 标签页".to_string()
            }
        })?;
    let target_id = target
        .id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "第一个 page 标签页缺少 targetId".to_string())?;
    let web_socket_debugger_url = target
        .web_socket_debugger_url
        .ok_or_else(|| "找到 page 标签页，但都缺少 WebSocket 调试地址".to_string())?;

    navigate_page(&web_socket_debugger_url, &url).map_err(|_| "CDP 导航失败".to_string())?;

    Ok(RuntimeTabNavigationResult {
        profile_id: profile_id.to_string(),
        target_id,
        url,
        navigated_at,
    })
}

pub(crate) fn send_cdp_page_navigate(web_socket_url: &str, url: &str) -> Result<(), String> {
    send_cdp_page_navigate_with_timeout(
        web_socket_url,
        url,
        Duration::from_millis(CDP_NAVIGATE_TIMEOUT_MS),
    )
}

pub(crate) fn send_cdp_page_navigate_with_timeout(
    web_socket_url: &str,
    url: &str,
    timeout: Duration,
) -> Result<(), String> {
    let parsed = url::Url::parse(web_socket_url).map_err(|_| "CDP 连接失败".to_string())?;
    if parsed.scheme() != "ws" {
        return Err("CDP 连接失败".to_string());
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "CDP 连接失败".to_string())?;
    let address = match parsed.host_str() {
        Some("127.0.0.1") | Some("localhost") => SocketAddr::from(([127, 0, 0, 1], port)),
        Some("::1") => SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], port)),
        _ => return Err("CDP 连接失败".to_string()),
    };

    let started_at = Instant::now();
    let stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| clean_cdp_navigation_io_error(&error, started_at, timeout, true))?;
    stream
        .set_nonblocking(true)
        .map_err(|_| "CDP 连接失败".to_string())?;
    let mut socket = complete_cdp_websocket_handshake(web_socket_url, stream, started_at, timeout)?;
    if let Err(error) = write_cdp_page_navigate_command(&mut socket, url, started_at, timeout) {
        best_effort_close_cdp_websocket(&mut socket, started_at, timeout);
        return Err(error);
    }

    let result = loop {
        if let Err(error) = remaining_cdp_navigation_timeout(started_at, timeout) {
            break Err(error);
        }
        let message = match socket.read() {
            Ok(message) => message,
            Err(error) if is_cdp_would_block(&error) => {
                if let Err(error) = wait_for_cdp_io_retry(started_at, timeout) {
                    break Err(error);
                }
                continue;
            }
            Err(tungstenite::Error::Io(error)) => {
                break Err(clean_cdp_navigation_io_error(
                    &error, started_at, timeout, false,
                ));
            }
            Err(_) => break Err("CDP 导航失败".to_string()),
        };
        let tungstenite::Message::Text(text) = message else {
            continue;
        };
        let payload: serde_json::Value = match serde_json::from_str(text.as_str()) {
            Ok(payload) => payload,
            Err(_) => break Err("CDP 导航失败".to_string()),
        };
        if payload.get("id").and_then(serde_json::Value::as_u64) != Some(1) {
            continue;
        }
        if payload.get("error").is_some() {
            break Err("CDP 导航失败".to_string());
        }
        if let Some(result) = payload.get("result") {
            if result
                .get("errorText")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|value| !value.is_empty())
            {
                break Err("CDP 导航失败".to_string());
            }
            break Ok(());
        }
        break Err("CDP 导航失败".to_string());
    };

    best_effort_close_cdp_websocket(&mut socket, started_at, timeout);
    result
}

pub(crate) fn best_effort_close_cdp_websocket(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    started_at: Instant,
    timeout: Duration,
) {
    if remaining_cdp_navigation_timeout(started_at, timeout).is_ok() {
        let _ = socket.close(None);
        let _ = socket.flush();
    }
}

pub(crate) fn write_cdp_page_navigate_command(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    url: &str,
    started_at: Instant,
    timeout: Duration,
) -> Result<(), String> {
    remaining_cdp_navigation_timeout(started_at, timeout)?;
    let message = tungstenite::Message::Text(
        serde_json::json!({
            "id": 1,
            "method": "Page.navigate",
            "params": {
                "url": url
            }
        })
        .to_string()
        .into(),
    );
    match socket.write(message) {
        Ok(()) => {}
        Err(error) if is_cdp_would_block(&error) => {}
        Err(_) => return Err("CDP 导航失败".to_string()),
    }

    loop {
        remaining_cdp_navigation_timeout(started_at, timeout)?;
        match socket.flush() {
            Ok(()) => return Ok(()),
            Err(error) if is_cdp_would_block(&error) => {
                wait_for_cdp_io_retry(started_at, timeout)?;
            }
            Err(_) => return Err("CDP 导航失败".to_string()),
        }
    }
}

pub(crate) fn complete_cdp_websocket_handshake(
    web_socket_url: &str,
    stream: TcpStream,
    started_at: Instant,
    timeout: Duration,
) -> Result<tungstenite::WebSocket<TcpStream>, String> {
    let mut handshake = match tungstenite::client(web_socket_url, stream) {
        Ok((socket, _)) => {
            remaining_cdp_navigation_timeout(started_at, timeout)?;
            return Ok(socket);
        }
        Err(tungstenite::HandshakeError::Interrupted(handshake)) => handshake,
        Err(tungstenite::HandshakeError::Failure(error)) => {
            return Err(clean_cdp_handshake_error(error, started_at, timeout));
        }
    };

    loop {
        let remaining = remaining_cdp_navigation_timeout(started_at, timeout)?;
        std::thread::sleep(remaining.min(Duration::from_millis(1)));
        match handshake.handshake() {
            Ok((socket, _)) => {
                remaining_cdp_navigation_timeout(started_at, timeout)?;
                return Ok(socket);
            }
            Err(tungstenite::HandshakeError::Interrupted(next_handshake)) => {
                handshake = next_handshake;
            }
            Err(tungstenite::HandshakeError::Failure(error)) => {
                return Err(clean_cdp_handshake_error(error, started_at, timeout));
            }
        }
    }
}

pub(crate) fn wait_for_cdp_io_retry(started_at: Instant, timeout: Duration) -> Result<(), String> {
    let remaining = remaining_cdp_navigation_timeout(started_at, timeout)?;
    std::thread::sleep(remaining.min(Duration::from_millis(1)));
    Ok(())
}

pub(crate) fn is_cdp_would_block(error: &tungstenite::Error) -> bool {
    matches!(
        error,
        tungstenite::Error::Io(io_error)
            if io_error.kind() == std::io::ErrorKind::WouldBlock
    )
}

pub(crate) fn clean_cdp_handshake_error(
    error: tungstenite::Error,
    started_at: Instant,
    timeout: Duration,
) -> String {
    if started_at.elapsed() >= timeout
        || matches!(
            error,
            tungstenite::Error::Io(ref io_error)
                if matches!(
                    io_error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                )
        )
    {
        "CDP 导航超时".to_string()
    } else {
        "CDP 连接失败".to_string()
    }
}

pub(crate) fn remaining_cdp_navigation_timeout(
    started_at: Instant,
    timeout: Duration,
) -> Result<Duration, String> {
    timeout
        .checked_sub(started_at.elapsed())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| "CDP 导航超时".to_string())
}

pub(crate) fn clean_cdp_navigation_io_error(
    error: &std::io::Error,
    started_at: Instant,
    timeout: Duration,
    connecting: bool,
) -> String {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) || started_at.elapsed() >= timeout
    {
        return "CDP 导航超时".to_string();
    }
    if connecting {
        "CDP 连接失败".to_string()
    } else {
        "CDP 导航失败".to_string()
    }
}

pub(crate) fn tab_snapshot_from_cdp_target(
    target: CdpTargetRaw,
    checked_at: u64,
) -> Option<TabSnapshot> {
    if target.r#type.as_deref() != Some("page") {
        return None;
    }

    let target_id = target.id?.trim().to_string();
    if target_id.is_empty() {
        return None;
    }

    Some(TabSnapshot {
        target_id,
        r#type: "page".to_string(),
        url: target.url.unwrap_or_default(),
        title: target.title.unwrap_or_default(),
        web_socket_debugger_url: target
            .web_socket_debugger_url
            .filter(|value| !value.trim().is_empty()),
        checked_at,
    })
}

pub(crate) fn fetch_cdp_tabs(port: u16) -> Result<Vec<CdpTargetRaw>, String> {
    let timeout = Duration::from_millis(CDP_LIST_TIMEOUT_MS);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let started_at = Instant::now();
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
    let remaining_timeout = remaining_cdp_timeout(started_at, CDP_LIST_TIMEOUT_MS)?;
    stream
        .set_read_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .set_write_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    let request = format!(
        "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;

    let body = read_cdp_list_response_body(&mut stream, started_at)?;
    serde_json::from_slice::<Vec<CdpTargetRaw>>(&body).map_err(|_| "CDP 连接失败".to_string())
}

pub(crate) fn probe_cdp_version(port: u16) -> Result<(), String> {
    let timeout = Duration::from_millis(CDP_PROBE_TIMEOUT_MS);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let started_at = Instant::now();
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
    let remaining_timeout = remaining_cdp_probe_timeout(started_at)?;
    stream
        .set_read_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .set_write_timeout(Some(remaining_timeout))
        .map_err(|_| "CDP 连接失败".to_string())?;
    stream
        .write_all(b"GET /json/version HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .map_err(|error| short_cdp_probe_error(&error.to_string()))?;

    stream
        .set_read_timeout(Some(remaining_cdp_probe_timeout(started_at)?))
        .map_err(|_| "CDP 连接失败".to_string())?;
    let status_line = read_http_status_line(&mut stream)?;
    if status_line.starts_with("HTTP/1.1 200") || status_line.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err("CDP 连接失败".to_string())
    }
}

pub(crate) fn remaining_cdp_probe_timeout(started_at: Instant) -> Result<Duration, String> {
    remaining_cdp_timeout(started_at, CDP_PROBE_TIMEOUT_MS)
}

pub(crate) fn remaining_cdp_timeout(
    started_at: Instant,
    timeout_ms: u64,
) -> Result<Duration, String> {
    Duration::from_millis(timeout_ms)
        .checked_sub(started_at.elapsed())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| "CDP 探测超时".to_string())
}

pub(crate) fn read_cdp_list_response_body(
    stream: &mut TcpStream,
    started_at: Instant,
) -> Result<Vec<u8>, String> {
    let mut response = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        stream
            .set_read_timeout(Some(remaining_cdp_timeout(
                started_at,
                CDP_LIST_TIMEOUT_MS,
            )?))
            .map_err(|_| "CDP 连接失败".to_string())?;
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
        if bytes_read == 0 {
            return Err("CDP 连接失败".to_string());
        }
        response.extend_from_slice(&buffer[..bytes_read]);
        if response.len() > CDP_LIST_MAX_BODY_BYTES {
            return Err("CDP 连接失败".to_string());
        }
        if let Some(index) = find_header_end(&response) {
            break index;
        }
    };

    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !is_http_ok(&headers) || uses_chunked_transfer(&headers) {
        return Err("CDP 连接失败".to_string());
    }

    let content_length = cdp_content_length(&headers)?;
    if content_length.is_some_and(|length| length > CDP_LIST_MAX_BODY_BYTES) {
        return Err("CDP 连接失败".to_string());
    }

    let mut body = response[header_end + 4..].to_vec();
    if let Some(content_length) = content_length {
        while body.len() < content_length {
            stream
                .set_read_timeout(Some(remaining_cdp_timeout(
                    started_at,
                    CDP_LIST_TIMEOUT_MS,
                )?))
                .map_err(|_| "CDP 连接失败".to_string())?;
            let bytes_read = stream
                .read(&mut buffer)
                .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
            if bytes_read == 0 {
                return Err("CDP 连接失败".to_string());
            }
            body.extend_from_slice(&buffer[..bytes_read]);
            if body.len() > CDP_LIST_MAX_BODY_BYTES {
                return Err("CDP 连接失败".to_string());
            }
        }
        body.truncate(content_length);
        return Ok(body);
    }

    loop {
        if body.len() > CDP_LIST_MAX_BODY_BYTES {
            return Err("CDP 连接失败".to_string());
        }
        stream
            .set_read_timeout(Some(remaining_cdp_timeout(
                started_at,
                CDP_LIST_TIMEOUT_MS,
            )?))
            .map_err(|_| "CDP 连接失败".to_string())?;
        let bytes_read = match stream.read(&mut buffer) {
            Ok(bytes_read) => bytes_read,
            Err(error) => return Err(short_cdp_probe_error(&error.to_string())),
        };
        if bytes_read == 0 {
            return Ok(body);
        }
        body.extend_from_slice(&buffer[..bytes_read]);
    }
}

pub(crate) fn find_header_end(response: &[u8]) -> Option<usize> {
    response.windows(4).position(|window| window == b"\r\n\r\n")
}

pub(crate) fn is_http_ok(headers: &str) -> bool {
    headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        == Some("200")
}

pub(crate) fn uses_chunked_transfer(headers: &str) -> bool {
    headers.lines().any(|line| {
        line.to_ascii_lowercase().starts_with("transfer-encoding:")
            && line.to_ascii_lowercase().contains("chunked")
    })
}

pub(crate) fn cdp_content_length(headers: &str) -> Result<Option<usize>, String> {
    let Some(line) = headers
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("content-length:"))
    else {
        return Ok(None);
    };

    line.split_once(':')
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .map(Some)
        .ok_or_else(|| "CDP 连接失败".to_string())
}

pub(crate) fn read_http_status_line(stream: &mut TcpStream) -> Result<String, String> {
    let mut response = Vec::new();
    let mut buffer = [0_u8; 64];

    loop {
        let bytes_read = stream
            .read(&mut buffer)
            .map_err(|error| short_cdp_probe_error(&error.to_string()))?;
        if bytes_read == 0 {
            break;
        }
        response.extend_from_slice(&buffer[..bytes_read]);
        if response.windows(2).any(|window| window == b"\r\n") || response.len() >= 512 {
            break;
        }
    }

    let response_text = String::from_utf8_lossy(&response);
    Ok(response_text
        .split("\r\n")
        .next()
        .unwrap_or_default()
        .to_string())
}

pub(crate) fn short_cdp_probe_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") || lower.contains("超时") {
        "CDP 探测超时".to_string()
    } else {
        "CDP 连接失败".to_string()
    }
}
