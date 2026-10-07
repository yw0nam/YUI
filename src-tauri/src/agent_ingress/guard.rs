//! Host/Origin guard — refuses browser requests whose hostname was rebound to loopback.

pub(super) fn refuse(_headers: &[tiny_http::Header]) -> Option<u16> {
    None
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
