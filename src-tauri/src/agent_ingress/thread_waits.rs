use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
pub(super) struct WaitSlots(AtomicUsize);
pub(super) struct WaitSlot<'a>(&'a WaitSlots);
impl WaitSlots {
    pub(super) const fn new() -> Self {
        Self(AtomicUsize::new(0))
    }
    pub(super) fn acquire(&self) -> Option<WaitSlot<'_>> {
        self.0
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 32).then_some(count + 1)
            })
            .ok()?;
        Some(WaitSlot(self))
    }
}
impl Drop for WaitSlot<'_> {
    fn drop(&mut self) {
        self.0 .0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_wait_cap_releases_capacity() {
        let slots = WaitSlots::default();
        let mut held = Vec::new();
        for _ in 0..32 {
            let slot = slots.acquire();
            assert!(slot.is_some(), "the first 32 answer waits are accepted");
            held.push(slot.unwrap());
        }
        assert!(slots.acquire().is_none(), "the 33rd answer wait is refused");
        held.pop();
        assert!(slots.acquire().is_some(), "an ended wait releases capacity");
    }
}
