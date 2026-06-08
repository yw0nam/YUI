use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use time::{Date, OffsetDateTime, UtcOffset};

/// Appends formatted log lines to `{base}_{YYYY-MM-DD}.log`, rotating at midnight in `offset`.
pub struct DateRotatingFile {
  dir: PathBuf,
  base: String,
  offset: UtcOffset,
  current_date: Option<Date>,
  inner: Option<File>,
}

impl DateRotatingFile {
  pub fn new(dir: PathBuf, base: String, offset: UtcOffset) -> Self {
    Self { dir, base, offset, current_date: None, inner: None }
  }

  fn dated_path(dir: &Path, base: &str, date: Date) -> PathBuf {
    dir.join(format!(
      "{base}_{:04}-{:02}-{:02}.log",
      date.year(),
      u8::from(date.month()),
      date.day()
    ))
  }

  fn append(&mut self, _date: Date, _buf: &[u8]) -> io::Result<()> {
    unimplemented!("not yet implemented")
  }
}

impl io::Write for DateRotatingFile {
  fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
    let date = OffsetDateTime::now_utc().to_offset(self.offset).date();
    self.append(date, buf)?;
    Ok(buf.len())
  }

  fn flush(&mut self) -> io::Result<()> {
    match self.inner.as_mut() {
      Some(f) => f.flush(),
      None => Ok(()),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use time::Month;

  fn scratch(tag: &str) -> PathBuf {
    let p = std::env::temp_dir()
      .join(format!("yui_logrot_{}_{}", std::process::id(), tag));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
  }

  fn d(y: i32, m: u8, day: u8) -> Date {
    Date::from_calendar_date(y, Month::try_from(m).unwrap(), day).unwrap()
  }

  #[test]
  fn dated_path_uses_base_and_iso_date() {
    let dir = scratch("dated_path");
    let path = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8));
    assert_eq!(path.file_name().unwrap(), "YUI_2026-06-08.log");
  }

  #[test]
  fn append_creates_dated_file() {
    let dir = scratch("creates");
    let mut f =
      DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
    f.append(d(2026, 6, 8), b"hello\n").unwrap();
    let content =
      fs::read(DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8)))
        .unwrap();
    assert_eq!(content, b"hello\n");
  }

  #[test]
  fn append_rotates_when_date_changes() {
    let dir = scratch("rotates");
    let mut f =
      DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
    f.append(d(2026, 6, 8), b"day1\n").unwrap();
    f.append(d(2026, 6, 9), b"day2\n").unwrap();
    let p1 = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8));
    let p2 = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 9));
    assert!(p1.exists(), "day1 file must exist");
    assert!(p2.exists(), "day2 file must exist");
    assert_eq!(fs::read(&p1).unwrap(), b"day1\n");
    assert_eq!(fs::read(&p2).unwrap(), b"day2\n");
  }

  #[test]
  fn append_same_date_is_appended() {
    let dir = scratch("same_date");
    let mut f =
      DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
    f.append(d(2026, 6, 8), b"part1\n").unwrap();
    f.append(d(2026, 6, 8), b"part2\n").unwrap();
    let content =
      fs::read(DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8)))
        .unwrap();
    assert_eq!(content, b"part1\npart2\n");
  }

  #[test]
  fn new_instance_appends_not_truncates() {
    let dir = scratch("no_truncate");
    let path = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8));
    fs::write(&path, b"existing\n").unwrap();
    let mut f =
      DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
    f.append(d(2026, 6, 8), b"new\n").unwrap();
    let content = fs::read(&path).unwrap();
    assert_eq!(content, b"existing\nnew\n");
  }
}
