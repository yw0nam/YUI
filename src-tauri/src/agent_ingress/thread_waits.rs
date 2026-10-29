use std::sync::atomic::AtomicUsize;

#[derive(Default)]
pub(super) struct WaitSlots(AtomicUsize);
pub(super) struct WaitSlot;
impl WaitSlots {
    pub(super) fn acquire(&self) -> Option<WaitSlot> {
        None
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
