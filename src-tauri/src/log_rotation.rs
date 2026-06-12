use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use time::{Date, Duration, Month, OffsetDateTime, UtcOffset};

/// Keep today plus this many prior days of dated log files; older ones are pruned.
const RETENTION: Duration = Duration::days(14);

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
        Self {
            dir,
            base,
            offset,
            current_date: None,
            inner: None,
        }
    }

    fn dated_path(dir: &Path, base: &str, date: Date) -> PathBuf {
        dir.join(format!(
            "{base}_{:04}-{:02}-{:02}.log",
            date.year(),
            u8::from(date.month()),
            date.day()
        ))
    }

    fn append(&mut self, date: Date, buf: &[u8]) -> io::Result<()> {
        if self.current_date != Some(date) {
            if let Some(mut f) = self.inner.take() {
                f.flush()?;
            }
            fs::create_dir_all(&self.dir)?;
            let path = Self::dated_path(&self.dir, &self.base, date);
            self.inner = Some(OpenOptions::new().create(true).append(true).open(path)?);
            self.current_date = Some(date);
            prune_older_than(&self.dir, &self.base, date - RETENTION);
        }
        self.inner.as_mut().unwrap().write_all(buf)
    }
}

/// Deletes `{base}_YYYY-MM-DD.log` files in `dir` whose date is strictly before `cutoff`.
/// Best-effort: every fs error is swallowed so a sweep never breaks logging.
fn prune_older_than(dir: &Path, base: &str, cutoff: Date) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let name = match name.to_str() {
            Some(n) => n,
            None => continue,
        };
        if let Some(date) = parse_dated_name(name, base) {
            if date < cutoff {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// Extracts the date from `{base}_YYYY-MM-DD.log`; returns `None` if it doesn't match.
fn parse_dated_name(name: &str, base: &str) -> Option<Date> {
    let stem = name
        .strip_prefix(base)?
        .strip_prefix('_')?
        .strip_suffix(".log")?;
    let mut parts = stem.split('-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u8 = parts.next()?.parse().ok()?;
    let day: u8 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Date::from_calendar_date(y, Month::try_from(m).ok()?, day).ok()
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
        let p = std::env::temp_dir().join(format!("yui_logrot_{}_{}", std::process::id(), tag));
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
        let mut f = DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
        f.append(d(2026, 6, 8), b"hello\n").unwrap();
        let content = fs::read(DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8))).unwrap();
        assert_eq!(content, b"hello\n");
    }

    #[test]
    fn append_rotates_when_date_changes() {
        let dir = scratch("rotates");
        let mut f = DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
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
        let mut f = DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
        f.append(d(2026, 6, 8), b"part1\n").unwrap();
        f.append(d(2026, 6, 8), b"part2\n").unwrap();
        let content = fs::read(DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8))).unwrap();
        assert_eq!(content, b"part1\npart2\n");
    }

    #[test]
    fn new_instance_appends_not_truncates() {
        let dir = scratch("no_truncate");
        let path = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8));
        fs::write(&path, b"existing\n").unwrap();
        let mut f = DateRotatingFile::new(dir.clone(), "YUI".into(), UtcOffset::UTC);
        f.append(d(2026, 6, 8), b"new\n").unwrap();
        let content = fs::read(&path).unwrap();
        assert_eq!(content, b"existing\nnew\n");
    }

    fn touch(dir: &Path, name: &str) {
        fs::write(dir.join(name), b"x\n").unwrap();
    }

    #[test]
    fn prune_deletes_file_older_than_retention() {
        let dir = scratch("prune_old");
        let old = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 5, 24));
        fs::write(&old, b"old\n").unwrap();
        prune_older_than(&dir, "YUI", d(2026, 5, 25));
        assert!(!old.exists(), "file 15 days old must be deleted");
    }

    #[test]
    fn prune_keeps_cutoff_and_today() {
        let dir = scratch("prune_keep");
        let cutoff = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 5, 25));
        let today = DateRotatingFile::dated_path(&dir, "YUI", d(2026, 6, 8));
        fs::write(&cutoff, b"cutoff\n").unwrap();
        fs::write(&today, b"today\n").unwrap();
        prune_older_than(&dir, "YUI", d(2026, 5, 25));
        assert!(cutoff.exists(), "file at cutoff (14 days old) must be kept");
        assert!(today.exists(), "today's file must be kept");
    }

    #[test]
    fn prune_ignores_foreign_and_undated_files() {
        let dir = scratch("prune_foreign");
        touch(&dir, "OTHER_2026-05-01.log");
        touch(&dir, "YUI.log");
        touch(&dir, "YUI_not-a-date.log");
        touch(&dir, "notes.txt");
        prune_older_than(&dir, "YUI", d(2026, 6, 8));
        assert!(dir.join("OTHER_2026-05-01.log").exists());
        assert!(dir.join("YUI.log").exists());
        assert!(dir.join("YUI_not-a-date.log").exists());
        assert!(dir.join("notes.txt").exists());
    }

    #[test]
    fn prune_does_not_panic_on_missing_dir() {
        let dir = scratch("prune_missing").join("absent");
        prune_older_than(&dir, "YUI", d(2026, 6, 8));
    }

    #[test]
    fn prune_keeps_directory_entries() {
        let dir = scratch("prune_subdir");
        fs::create_dir(dir.join("YUI_2026-01-01.log")).unwrap();
        prune_older_than(&dir, "YUI", d(2026, 6, 8));
        assert!(dir.join("YUI_2026-01-01.log").is_dir());
    }
}
