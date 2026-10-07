//! Host/Origin guard — refuses browser requests whose hostname was rebound to loopback.

const LOOPBACK_NAMES: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

/// `Some(421)` for a non-loopback `Host`, `Some(403)` for a non-loopback `Origin`, else `None`.
pub(super) fn refuse(headers: &[tiny_http::Header]) -> Option<u16> {
    let value = |name| {
        headers
            .iter()
            .find(|h| h.field.equiv(name))
            .map(|h| h.value.as_str())
    };
    if !value("Host").is_some_and(is_loopback_host) {
        return Some(421);
    }
    match value("Origin") {
        Some(origin)
            if !is_loopback_host(origin.split_once("://").map_or("", |(_, rest)| rest)) =>
        {
            Some(403)
        }
        _ => None,
    }
}

/// True when `host[:port]` (or `[v6]:port`) names a loopback host.
fn is_loopback_host(hostport: &str) -> bool {
    let host = match hostport.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => hostport.split(':').next().unwrap_or(""),
    };
    LOOPBACK_NAMES
        .iter()
        .any(|name| name.eq_ignore_ascii_case(host))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> Vec<tiny_http::Header> {
        pairs
            .iter()
            .map(|(k, v)| tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap())
            .collect()
    }

    #[test]
    fn loopback_hosts_pass() {
        for host in ["127.0.0.1:8770", "localhost:8770", "[::1]:8770"] {
            assert_eq!(refuse(&headers(&[("Host", host)])), None, "{host}");
        }
    }

    #[test]
    fn foreign_host_is_refused_with_421() {
        assert_eq!(
            refuse(&headers(&[("Host", "evil.example:8770")])),
            Some(421)
        );
    }

    #[test]
    fn missing_host_is_refused_with_421() {
        assert_eq!(refuse(&[]), Some(421));
    }

    #[test]
    fn foreign_origin_is_refused_with_403() {
        let h = headers(&[
            ("Host", "127.0.0.1:8770"),
            ("Origin", "http://evil.example:8770"),
        ]);
        assert_eq!(refuse(&h), Some(403));
    }

    #[test]
    fn loopback_origin_passes() {
        let h = headers(&[
            ("host", "127.0.0.1:8770"),
            ("origin", "http://localhost:1420"),
        ]);
        assert_eq!(refuse(&h), None);
    }
}
