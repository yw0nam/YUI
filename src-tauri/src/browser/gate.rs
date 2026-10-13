//! Generation, cancellation and the effect phase of one browser operation.

use super::outcome::{unknown, BROWSER_CLOSED, CANCELLED};
use std::future::{pending, Future};
pub use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

/// The generation counter and the in-flight operation's token; `cancel` never waits on an operation.
#[derive(Default)]
pub struct Gate {
    generation: u64,
    inflight: Option<CancellationToken>,
}

impl Gate {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Starts a new generation and cancels the operation in flight.
    pub fn cancel(&mut self) -> u64 {
        self.generation += 1;
        if let Some(token) = self.inflight.take() {
            token.cancel();
        }
        self.generation
    }

    /// Installs a token for an operation of `generation`, or refuses a stale one.
    pub fn admit(&mut self, generation: u64) -> Option<CancellationToken> {
        if generation != self.generation {
            return None;
        }
        let token = CancellationToken::new();
        self.inflight = Some(token.clone());
        Some(token)
    }

    pub fn finish(&mut self) {
        self.inflight = None;
    }
}

/// Why an awaited call stopped before it finished.
#[derive(Debug, PartialEq, Eq)]
pub enum Halt {
    Cancelled,
    Closed,
}

/// One admitted operation: its cancel token, work deadline and whether a page command was sent.
pub struct Op {
    action: &'static str,
    token: CancellationToken,
    deadline: Instant,
    closed: Option<CancellationToken>,
    effect_started: bool,
}

impl Op {
    pub fn new(action: &'static str, token: CancellationToken, deadline: Instant) -> Self {
        Self {
            action,
            token,
            deadline,
            closed: None,
            effect_started: false,
        }
    }

    pub fn action(&self) -> &'static str {
        self.action
    }

    pub fn deadline(&self) -> Instant {
        self.deadline
    }

    /// Also halts on `closed`, the owned browser's disconnect signal.
    pub fn watch(&mut self, closed: CancellationToken) {
        self.closed = Some(closed);
    }

    /// Marks that an effectful page command is about to be sent.
    pub fn effect(&mut self) {
        self.effect_started = true;
    }

    /// Runs `fut` until it finishes, the operation is cancelled, its deadline passes or the browser closes.
    /// Why the operation must stop before its next step, if it must.
    pub fn halt_now(&self) -> Option<Halt> {
        if self.token.is_cancelled() || Instant::now() >= self.deadline {
            Some(Halt::Cancelled)
        } else if self
            .closed
            .as_ref()
            .is_some_and(CancellationToken::is_cancelled)
        {
            Some(Halt::Closed)
        } else {
            None
        }
    }

    pub async fn guard<F: Future>(&self, fut: F) -> Result<F::Output, Halt> {
        let closed = async {
            match &self.closed {
                Some(closed) => closed.cancelled().await,
                None => pending().await,
            }
        };
        tokio::select! {
            biased;
            _ = self.token.cancelled() => Err(Halt::Cancelled),
            _ = closed => Err(Halt::Closed),
            _ = tokio::time::sleep_until(self.deadline) => Err(Halt::Cancelled),
            out = fut => Ok(out),
        }
    }

    pub fn halted(&self, halt: Halt) -> String {
        match (self.effect_started, halt) {
            (true, _) => unknown(self.action),
            (false, Halt::Closed) => BROWSER_CLOSED.to_string(),
            (false, Halt::Cancelled) => CANCELLED.to_string(),
        }
    }
}

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
