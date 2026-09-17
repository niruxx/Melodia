use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rodio::source::SeekError;
use rodio::{ChannelCount, Sample, SampleRate, Source};

const PENDING: u8 = 0;
const STARTED: u8 = 1;
const CANCELLED: u8 = 2;

/// Shared fate of a track queued behind the one playing.
///
/// A rodio queue can't have an entry taken back out, so a preloaded track the
/// user no longer wants next is neutralised instead: cancelled before its first
/// sample, it ends immediately and the queue moves past it. Once it has
/// started it is simply the track that's playing, and cancelling is a no-op.
///
/// A single state word decided by compare-and-swap, rather than two flags,
/// guarantees the audio thread and the command thread can't each believe they
/// won — one of "started" or "cancelled" happens, never both.
pub struct NextHandle {
    state: AtomicU8,
}

impl NextHandle {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: AtomicU8::new(PENDING),
        })
    }

    /// Returns false when the track had already started, so there was
    /// nothing left to cancel.
    pub fn cancel(&self) -> bool {
        self.state
            .compare_exchange(PENDING, CANCELLED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
            || self.state.load(Ordering::SeqCst) == CANCELLED
    }

    pub fn has_started(&self) -> bool {
        self.state.load(Ordering::SeqCst) == STARTED
    }

    fn try_start(&self) -> bool {
        self.state
            .compare_exchange(PENDING, STARTED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
            || self.state.load(Ordering::SeqCst) == STARTED
    }
}

/// Wraps a queued track so it can be withdrawn up until it begins playing.
pub struct Cancellable<I> {
    input: I,
    handle: Arc<NextHandle>,
    /// None until the first pull decides whether this track plays at all.
    live: Option<bool>,
}

impl<I> Cancellable<I> {
    pub fn new(input: I, handle: Arc<NextHandle>) -> Self {
        Self {
            input,
            handle,
            live: None,
        }
    }
}

impl<I> Iterator for Cancellable<I>
where
    I: Source,
{
    type Item = Sample;

    #[inline]
    fn next(&mut self) -> Option<Sample> {
        let live = *self.live.get_or_insert_with(|| self.handle.try_start());
        if live {
            self.input.next()
        } else {
            None
        }
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        match self.live {
            Some(false) => (0, Some(0)),
            _ => self.input.size_hint(),
        }
    }
}

impl<I> Source for Cancellable<I>
where
    I: Source,
{
    #[inline]
    fn current_span_len(&self) -> Option<usize> {
        match self.live {
            Some(false) => Some(0),
            _ => self.input.current_span_len(),
        }
    }

    #[inline]
    fn channels(&self) -> ChannelCount {
        self.input.channels()
    }

    #[inline]
    fn sample_rate(&self) -> SampleRate {
        self.input.sample_rate()
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration()
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.input.try_seek(pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;
    use rodio::Player;

    fn buffer(samples: Vec<f32>) -> SamplesBuffer {
        SamplesBuffer::new(
            ChannelCount::new(2).unwrap(),
            SampleRate::new(44100).unwrap(),
            samples,
        )
    }

    /// The whole feature in one assertion: two tracks queued on one player
    /// come out back to back, with not a single sample of silence between.
    #[test]
    fn queued_tracks_join_without_a_gap() {
        let (player, mut output) = Player::new();
        let first: Vec<f32> = (0..1000).map(|i| 0.1 + i as f32 * 1e-4).collect();
        let second: Vec<f32> = (0..1000).map(|i| -0.1 - i as f32 * 1e-4).collect();

        player.append(buffer(first.clone()));
        player.append(Cancellable::new(buffer(second.clone()), NextHandle::new()));

        let played: Vec<f32> = output.by_ref().take(2000).collect();
        let expected: Vec<f32> = first.into_iter().chain(second).collect();
        assert_eq!(played, expected);
    }

    #[test]
    fn a_cancelled_track_is_skipped_entirely() {
        let (player, mut output) = Player::new();
        let first = vec![0.5f32; 100];
        let handle = NextHandle::new();

        player.append(buffer(first.clone()));
        player.append(Cancellable::new(buffer(vec![0.9; 100]), handle.clone()));
        assert!(handle.cancel(), "nothing had played yet, so this cancels");

        let played: Vec<f32> = output.by_ref().take(200).collect();
        assert_eq!(&played[..100], &first[..]);
        assert!(
            played[100..].iter().all(|s| *s == 0.0),
            "only keep-alive silence may follow, never the cancelled audio"
        );
        assert!(!handle.has_started());
    }

    #[test]
    fn starting_is_observable_from_outside() {
        let (player, mut output) = Player::new();
        let handle = NextHandle::new();
        player.append(buffer(vec![0.1; 4]));
        player.append(Cancellable::new(buffer(vec![0.2; 4]), handle.clone()));

        let _: Vec<f32> = output.by_ref().take(4).collect();
        assert!(!handle.has_started(), "still on the first track");
        let _ = output.next();
        assert!(handle.has_started(), "first sample of the second track was pulled");
    }

    /// Once a track is audible it is the current track; a late cancel must not
    /// cut it off mid-song.
    #[test]
    fn cancelling_after_start_is_refused() {
        let handle = NextHandle::new();
        let mut source = Cancellable::new(buffer(vec![0.3; 8]), handle.clone());
        assert_eq!(source.next(), Some(0.3));
        assert!(!handle.cancel());
        assert_eq!(source.by_ref().count(), 7, "the rest still plays");
    }
}
