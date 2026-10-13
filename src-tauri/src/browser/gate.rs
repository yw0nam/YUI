#[cfg(test)]
mod tests {
    use super::*;
    use std::future::pending;
    use std::time::Duration;

    fn far() -> Instant {
        Instant::now() + Duration::from_secs(60)
    }

    #[test]
    fn admit_refuses_a_stale_generation() {
        let mut gate = Gate::default();
        let stale = gate.generation();
        gate.cancel();
        assert!(gate.admit(stale).is_none());
        assert!(gate.admit(gate.generation()).is_some());
    }

    #[test]
    fn cancel_bumps_the_generation_and_cancels_the_installed_token() {
        let mut gate = Gate::default();
        let before = gate.generation();
        let token = gate.admit(before).unwrap();
        assert_eq!(gate.cancel(), before + 1);
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn a_halt_before_the_effect_reports_that_nothing_ran() {
        let token = CancellationToken::new();
        let op = Op::new("click", token.clone(), far());
        token.cancel();
        let halt = op.guard(pending::<()>()).await.unwrap_err();
        assert_eq!(op.halted(halt), "cancelled: nothing ran");

        let mut op = Op::new("click", CancellationToken::new(), far());
        let closed = CancellationToken::new();
        op.watch(closed.clone());
        closed.cancel();
        let halt = op.guard(pending::<()>()).await.unwrap_err();
        assert_eq!(op.halted(halt), "error: browser closed");
    }

    #[tokio::test]
    async fn a_cancel_after_the_effect_started_reports_unknown() {
        let token = CancellationToken::new();
        let mut op = Op::new("click", token.clone(), far());
        op.effect();
        token.cancel();
        let halt = op.guard(pending::<()>()).await.unwrap_err();
        assert_eq!(
            op.halted(halt),
            "unknown: click may have run; read before retrying"
        );
    }

    #[tokio::test]
    async fn a_passed_deadline_interrupts_a_stalled_call() {
        let op = Op::new("read", CancellationToken::new(), Instant::now());
        let halt = op.guard(pending::<()>()).await.unwrap_err();
        assert_eq!(op.halted(halt), "cancelled: nothing ran");
    }
}
