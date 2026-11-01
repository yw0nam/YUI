use std::io::Write;
use std::sync::Mutex;

/// A terminal's input.
pub struct Input(Mutex<Box<dyn Write + Send>>);

impl Input {
    pub fn new(writer: Box<dyn Write + Send>) -> Self {
        Self(Mutex::new(writer))
    }

    pub fn send(&self, data: Vec<u8>) -> Result<(), String> {
        let mut writer = self.0.lock().unwrap();
        writer
            .write_all(&data)
            .and_then(|()| writer.flush())
            .map_err(|error| format!("error: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::{Duration, Instant};

    /// A writer that blocks each write until the test opens it, then records the bytes.
    struct Blocked {
        open: mpsc::Receiver<()>,
        got: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for Blocked {
        fn write(&mut self, data: &[u8]) -> io::Result<usize> {
            let _ = self.open.recv();
            self.got.lock().unwrap().extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn input_returns_while_the_writer_blocks_and_arrives_in_order() {
        let (open, gate) = mpsc::channel();
        let got = Arc::new(Mutex::new(vec![]));
        let input = Arc::new(Input::new(Box::new(Blocked {
            open: gate,
            got: got.clone(),
        })));
        let (sent, done) = mpsc::channel();
        let sender = input.clone();
        thread::spawn(move || {
            sender.send(b"one".to_vec()).unwrap();
            sender.send(b"two".to_vec()).unwrap();
            let _ = sent.send(());
        });
        let returned = done.recv_timeout(Duration::from_secs(1)).is_ok();
        drop(open);
        assert!(returned, "both sends return while the writer is blocked");
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().as_slice() != b"onetwo" && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(got.lock().unwrap().as_slice(), b"onetwo");
    }
}
