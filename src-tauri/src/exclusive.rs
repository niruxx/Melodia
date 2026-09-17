//! Bit-perfect output.
//!
//! cpal only opens WASAPI in shared mode, where Windows' mixer resamples and
//! re-quantises everything to its own mix format. This drives a rodio queue
//! straight into a WASAPI *exclusive-mode* stream instead, opened at each
//! track's native sample rate, so the DAC receives the file's samples
//! unaltered. rodio's `Player` is kept as-is — only the thing pulling
//! samples out of it changes — so pause, seek, position and gapless queueing
//! all keep working.

/// How samples are laid out in the device buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Encoding {
    Int16,
    /// 24-bit samples in 3 bytes.
    Int24,
    /// 24 valid bits left-justified in a 32-bit container, which some USB
    /// DACs accept where they refuse packed 24-bit.
    Int24In32,
    Float32,
}

impl Encoding {
    pub fn bytes(self) -> usize {
        match self {
            Self::Int16 => 2,
            Self::Int24 => 3,
            Self::Int24In32 | Self::Float32 => 4,
        }
    }

    pub fn valid_bits(self) -> u16 {
        match self {
            Self::Int16 => 16,
            Self::Int24 | Self::Int24In32 => 24,
            Self::Float32 => 32,
        }
    }

    pub fn describe(self) -> &'static str {
        match self {
            Self::Int16 => "16-bit",
            Self::Int24 | Self::Int24In32 => "24-bit",
            Self::Float32 => "32-bit float",
        }
    }
}

/// The order formats are offered to the device in.
///
/// 24-bit integer first: it carries 16- and 24-bit sources exactly (a 16-bit
/// sample just gains eight zero bits, which changes nothing about the signal),
/// and it's what nearly every DAC takes natively. Float relies on the driver
/// to quantise, so it's only preferred over truncating to 16 bits.
pub const PREFERENCE: [Encoding; 4] = [
    Encoding::Int24,
    Encoding::Int24In32,
    Encoding::Float32,
    Encoding::Int16,
];

/// Writes one sample in the given encoding, little-endian.
///
/// Integer scaling is the exact inverse of Symphonia's decode scaling
/// (`i16 / 32768`, `i24 / 8388608`), and both are exactly representable in an
/// f32 — so a 16- or 24-bit file's samples come back out bit-for-bit.
#[inline]
pub fn encode(sample: f32, encoding: Encoding, out: &mut [u8]) {
    match encoding {
        Encoding::Int16 => {
            let v = (sample * 32_768.0).round().clamp(-32_768.0, 32_767.0) as i16;
            out[..2].copy_from_slice(&v.to_le_bytes());
        }
        Encoding::Int24 => {
            let v = (sample * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
            out[..3].copy_from_slice(&v.to_le_bytes()[..3]);
        }
        Encoding::Int24In32 => {
            let v = (sample * 8_388_608.0).round().clamp(-8_388_608.0, 8_388_607.0) as i32;
            out[..4].copy_from_slice(&(v << 8).to_le_bytes());
        }
        Encoding::Float32 => out[..4].copy_from_slice(&sample.to_le_bytes()),
    }
}

/// Speaker layout for a channel count. Exclusive-mode drivers can reject the
/// "no particular layout" mask, so the standard layouts are named explicitly.
pub fn channel_mask(channels: u16) -> u32 {
    match channels {
        1 => 0x4,   // front centre
        2 => 0x3,   // front left + right
        4 => 0x33,  // quad
        6 => 0x3F,  // 5.1
        8 => 0x63F, // 7.1
        _ => 0,
    }
}

pub fn describe_format(rate: u32, channels: u16, encoding: Encoding) -> String {
    let khz = rate as f64 / 1000.0;
    let rate = if khz.fract() == 0.0 { format!("{khz:.0}") } else { format!("{khz:.1}") };
    format!("{rate} kHz · {} · {channels} ch", encoding.describe())
}

/// Rates worth asking a device about, covering both families at 1×–8×.
pub const PROBE_RATES: [u32; 8] = [44_100, 48_000, 88_200, 96_000, 176_400, 192_000, 352_800, 384_000];

/// Chooses the rate to play a track at when the device may not take its own.
///
/// Returns the source rate itself whenever possible — that's the bit-perfect
/// case. Otherwise it stays within the same rate family (44.1 kHz or 48 kHz
/// multiples), where conversion is a simple integer ratio, preferring not to
/// throw bandwidth away; only then does it cross families.
pub fn pick_rate(source: u32, supported: &[u32]) -> Option<u32> {
    if supported.contains(&source) {
        return Some(source);
    }
    let family = |r: u32| r % 11_025 == 0;
    let mut sorted = supported.to_vec();
    sorted.sort_unstable();
    let same: Vec<u32> = sorted.iter().copied().filter(|r| family(*r) == family(source)).collect();

    same.iter()
        .copied()
        .find(|r| *r >= source)
        .or_else(|| same.last().copied())
        .or_else(|| sorted.iter().copied().find(|r| *r >= source))
        .or_else(|| sorted.last().copied())
}

/// What the render thread reports back to the audio thread.
pub enum ExclusiveEvent {
    /// A stream is open; carries a human description of the format.
    Opened(String),
    /// Exclusive mode can't be used (device busy, format refused, unplugged).
    Failed(String),
}

#[cfg(windows)]
pub use self::wasapi::ExclusiveOutput;

#[cfg(windows)]
mod wasapi {
    use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
    use std::thread::JoinHandle;

    use rodio::Source;
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, S_OK, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioClient, IAudioRenderClient, IMMDevice, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED,
        AUDCLNT_E_DEVICE_IN_USE, AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED, AUDCLNT_SHAREMODE_EXCLUSIVE,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
    };
    use windows::Win32::Media::KernelStreaming::{KSDATAFORMAT_SUBTYPE_PCM, WAVE_FORMAT_EXTENSIBLE};
    use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Threading::{
        AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, CreateEventW,
        WaitForSingleObject,
    };

    use super::{channel_mask, describe_format, encode, Encoding, ExclusiveEvent, PREFERENCE};

    type BoxedSource = Box<dyn Source + Send>;

    enum Control {
        Attach(BoxedSource),
        Stop,
    }

    /// Owns the render thread. Dropping it releases the device.
    pub struct ExclusiveOutput {
        tx: Sender<Control>,
        thread: Option<JoinHandle<()>>,
        stereo_rates: Vec<u32>,
    }

    impl ExclusiveOutput {
        /// Starts the render thread for a device (`None` = system default).
        /// Fails straight away if the device can't be found; format problems
        /// surface later, through `on_event`, once there's a track to play.
        pub fn open(
            endpoint_id: Option<String>,
            on_event: impl Fn(ExclusiveEvent) + Send + 'static,
        ) -> Result<Self, String> {
            let (tx, rx) = mpsc::channel();
            let (ready_tx, ready_rx) = mpsc::channel();
            let thread = std::thread::Builder::new()
                .name("wasapi-exclusive".into())
                .spawn(move || render_thread(endpoint_id, rx, ready_tx, on_event))
                .map_err(|e| e.to_string())?;
            match ready_rx.recv() {
                Ok(Ok(stereo_rates)) if stereo_rates.is_empty() => {
                    let _ = tx.send(Control::Stop);
                    let _ = thread.join();
                    Err("this device doesn't accept stereo audio in exclusive mode at any common \
                         sample rate"
                        .into())
                }
                Ok(Ok(stereo_rates)) => Ok(Self {
                    tx,
                    thread: Some(thread),
                    stereo_rates,
                }),
                Ok(Err(e)) => {
                    let _ = thread.join();
                    Err(e)
                }
                Err(_) => Err("the exclusive-mode output thread stopped unexpectedly".into()),
            }
        }

        /// Hands over a new source to play, replacing the previous one. Call
        /// once the first track is appended, so its format is what's seen.
        pub fn attach(&self, source: BoxedSource) {
            let _ = self.tx.send(Control::Attach(source));
        }

        /// Sample rates the device accepts for stereo in exclusive mode.
        pub fn stereo_rates(&self) -> &[u32] {
            &self.stereo_rates
        }
    }

    /// Asks the device which stereo rates it will take exclusively, in any
    /// encoding. Opening nothing, so it's cheap.
    unsafe fn probe_stereo_rates(device: &IMMDevice) -> Result<Vec<u32>, String> {
        let client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("couldn't open the device: {e}"))?;
        let mut rates = Vec::new();
        for rate in super::PROBE_RATES {
            for encoding in PREFERENCE {
                let fmt = waveformat(rate, 2, encoding);
                let ptr = &fmt as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX;
                let support = client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, ptr, None);
                if support == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
                    return Err(EXCLUSIVE_DISABLED.into());
                }
                if support == S_OK {
                    rates.push(rate);
                    break;
                }
            }
        }
        Ok(rates)
    }

    const EXCLUSIVE_DISABLED: &str = "exclusive mode is switched off for this device — enable \
        \"Allow applications to take exclusive control\" in its Windows sound properties \
        (Advanced tab)";

    impl Drop for ExclusiveOutput {
        fn drop(&mut self) {
            let _ = self.tx.send(Control::Stop);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    struct Stream {
        client: IAudioClient,
        render: IAudioRenderClient,
        event: HANDLE,
        frames: u32,
        rate: u32,
        channels: u16,
        encoding: Encoding,
    }

    impl Stream {
        fn block_align(&self) -> usize {
            self.channels as usize * self.encoding.bytes()
        }
    }

    impl Drop for Stream {
        fn drop(&mut self) {
            unsafe {
                let _ = self.client.Stop();
                let _ = CloseHandle(self.event);
            }
        }
    }

    fn waveformat(rate: u32, channels: u16, encoding: Encoding) -> WAVEFORMATEXTENSIBLE {
        let block_align = channels * encoding.bytes() as u16;
        WAVEFORMATEXTENSIBLE {
            Format: WAVEFORMATEX {
                wFormatTag: WAVE_FORMAT_EXTENSIBLE as u16,
                nChannels: channels,
                nSamplesPerSec: rate,
                nAvgBytesPerSec: rate * block_align as u32,
                nBlockAlign: block_align,
                wBitsPerSample: encoding.bytes() as u16 * 8,
                cbSize: (std::mem::size_of::<WAVEFORMATEXTENSIBLE>()
                    - std::mem::size_of::<WAVEFORMATEX>()) as u16,
            },
            Samples: WAVEFORMATEXTENSIBLE_0 {
                wValidBitsPerSample: encoding.valid_bits(),
            },
            dwChannelMask: channel_mask(channels),
            SubFormat: if encoding == Encoding::Float32 {
                KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            } else {
                KSDATAFORMAT_SUBTYPE_PCM
            },
        }
    }

    unsafe fn open_stream(device: &IMMDevice, rate: u32, channels: u16) -> Result<Stream, String> {
        let mut refusals = Vec::new();
        for encoding in PREFERENCE {
            let fmt = waveformat(rate, channels, encoding);
            let fmt_ptr = &fmt as *const WAVEFORMATEXTENSIBLE as *const WAVEFORMATEX;

            let mut client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("couldn't open the device: {e}"))?;
            let support = client.IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, fmt_ptr, None);
            if support == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED {
                return Err(EXCLUSIVE_DISABLED.into());
            }
            if support != S_OK {
                refusals.push(format!("{} ({:#010x})", encoding.describe(), support.0));
                continue;
            }

            let mut period = 0i64;
            client
                .GetDevicePeriod(Some(&mut period), None)
                .map_err(|e| format!("couldn't read the device period: {e}"))?;

            let init = |client: &IAudioClient, period: i64| {
                client.Initialize(
                    AUDCLNT_SHAREMODE_EXCLUSIVE,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                    period,
                    period,
                    fmt_ptr,
                    None,
                )
            };
            if let Err(e) = init(&client, period) {
                if e.code() == AUDCLNT_E_DEVICE_IN_USE {
                    return Err("another app is using this device in exclusive mode".into());
                }
                if e.code() != AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED {
                    return Err(format!("the device refused exclusive mode: {e}"));
                }
                // The documented dance: align the period to the buffer size
                // the driver wants, then start over on a fresh client.
                let frames = client.GetBufferSize().map_err(|e| e.to_string())?;
                period = (10_000_000.0 * frames as f64 / rate as f64).round() as i64;
                client = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
                init(&client, period).map_err(|e| format!("the device refused exclusive mode: {e}"))?;
            }

            let event = CreateEventW(None, false, false, PCWSTR::null()).map_err(|e| e.to_string())?;
            let stream = Stream {
                render: match client.GetService::<IAudioRenderClient>() {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = CloseHandle(event);
                        return Err(e.to_string());
                    }
                },
                frames: client.GetBufferSize().map_err(|e| e.to_string())?,
                client,
                event,
                rate,
                channels,
                encoding,
            };
            stream.client.SetEventHandle(event).map_err(|e| e.to_string())?;

            // The first event only fires after a buffer has been submitted.
            let buf = stream.render.GetBuffer(stream.frames).map_err(|e| e.to_string())?;
            std::ptr::write_bytes(buf, 0, stream.frames as usize * stream.block_align());
            stream
                .render
                .ReleaseBuffer(stream.frames, AUDCLNT_BUFFERFLAGS_SILENT.0 as u32)
                .map_err(|e| e.to_string())?;
            stream.client.Start().map_err(|e| e.to_string())?;
            return Ok(stream);
        }
        Err(format!(
            "the device doesn't accept {} in exclusive mode (tried {})",
            describe_format(rate, channels, Encoding::Int16).replace(" · 16-bit", ""),
            refusals.join(", ")
        ))
    }

    /// Where the fill loop stopped.
    enum Fill {
        Full,
        /// The source moved on to audio in a different format; the rest of
        /// this buffer is silence and the stream has to be reopened.
        FormatChanged,
        /// The source is finished for good.
        Ended,
    }

    /// Tracks where the next span boundary is, since that's the only point a
    /// rodio source may change format.
    struct Cursor {
        span_left: Option<usize>,
        checked: bool,
    }

    fn fill(source: &mut BoxedSource, cursor: &mut Cursor, stream: &Stream, out: &mut [u8]) -> Fill {
        let bytes = stream.encoding.bytes();
        let channels = stream.channels as usize;
        let frame = stream.block_align();

        for (f, chunk) in out.chunks_exact_mut(frame).enumerate() {
            if !cursor.checked || cursor.span_left == Some(0) || cursor.span_left.is_none() {
                if source.sample_rate().get() != stream.rate || source.channels().get() != stream.channels {
                    out[f * frame..].fill(0);
                    cursor.checked = false;
                    return Fill::FormatChanged;
                }
                cursor.span_left = source.current_span_len();
                cursor.checked = true;
            }
            for c in 0..channels {
                match source.next() {
                    Some(s) => encode(s, stream.encoding, &mut chunk[c * bytes..]),
                    None => {
                        out[f * frame + c * bytes..].fill(0);
                        return Fill::Ended;
                    }
                }
            }
            if let Some(n) = cursor.span_left.as_mut() {
                *n = n.saturating_sub(channels);
            }
        }
        Fill::Full
    }

    unsafe fn resolve_device(endpoint_id: Option<&str>) -> Result<IMMDevice, String> {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("couldn't list audio devices: {e}"))?;
        match endpoint_id {
            Some(id) => enumerator
                .GetDevice(&HSTRING::from(id))
                .map_err(|_| "that audio output isn't connected any more".to_string()),
            None => enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|e| format!("there's no default audio output: {e}")),
        }
    }

    fn render_thread(
        endpoint_id: Option<String>,
        rx: Receiver<Control>,
        ready: Sender<Result<Vec<u32>, String>>,
        on_event: impl Fn(ExclusiveEvent),
    ) {
        unsafe {
            let com = CoInitializeEx(None, COINIT_MULTITHREADED);
            let probed = resolve_device(endpoint_id.as_deref())
                .and_then(|device| probe_stereo_rates(&device).map(|rates| (device, rates)));
            let device = match probed {
                Ok((device, rates)) => {
                    let _ = ready.send(Ok(rates));
                    device
                }
                Err(e) => {
                    let _ = ready.send(Err(e));
                    if com.is_ok() {
                        CoUninitialize();
                    }
                    return;
                }
            };

            // Exclusive mode leaves no mixer buffer to hide a late wake-up;
            // MMCSS scheduling is what keeps the buffer fed in time.
            let mut task_index = 0u32;
            let mmcss = AvSetMmThreadCharacteristicsW(&HSTRING::from("Pro Audio"), &mut task_index).ok();

            run(&device, &rx, &on_event);

            if let Some(handle) = mmcss {
                let _ = AvRevertMmThreadCharacteristics(handle);
            }
            drop(device);
            if com.is_ok() {
                CoUninitialize();
            }
        }
    }

    unsafe fn run(device: &IMMDevice, rx: &Receiver<Control>, on_event: &impl Fn(ExclusiveEvent)) {
        let mut source: Option<BoxedSource> = None;
        let mut stream: Option<Stream> = None;
        let mut cursor = Cursor { span_left: None, checked: false };

        loop {
            // Block while there's nothing to do; otherwise just drain.
            let control = if stream.is_none() && source.is_none() {
                rx.recv().ok()
            } else {
                match rx.try_recv() {
                    Ok(c) => Some(c),
                    Err(TryRecvError::Empty) => None,
                    Err(TryRecvError::Disconnected) => Some(Control::Stop),
                }
            };
            match control {
                Some(Control::Stop) => return,
                Some(Control::Attach(s)) => {
                    source = Some(s);
                    cursor = Cursor { span_left: None, checked: false };
                }
                None if stream.is_none() && source.is_none() => return,
                None => {}
            }

            // (Re)open when there's audio whose format the stream doesn't match.
            if let Some(src) = source.as_ref() {
                let (rate, channels) = (src.sample_rate().get(), src.channels().get());
                let matches = stream.as_ref().is_some_and(|s| s.rate == rate && s.channels == channels);
                if !matches {
                    stream = None;
                    match open_stream(device, rate, channels) {
                        Ok(s) => {
                            on_event(ExclusiveEvent::Opened(describe_format(rate, channels, s.encoding)));
                            stream = Some(s);
                        }
                        Err(e) => {
                            on_event(ExclusiveEvent::Failed(e));
                            source = None;
                            continue;
                        }
                    }
                }
            }
            let Some(s) = stream.as_ref() else { continue };

            // Two seconds without a buffer request means the device is gone.
            if WaitForSingleObject(s.event, 2000) != WAIT_OBJECT_0 {
                on_event(ExclusiveEvent::Failed("the audio device stopped responding".into()));
                return;
            }
            let buf = match s.render.GetBuffer(s.frames) {
                Ok(b) => b,
                Err(e) => {
                    on_event(ExclusiveEvent::Failed(format!("the audio device went away: {e}")));
                    return;
                }
            };
            let len = s.frames as usize * s.block_align();
            let out = std::slice::from_raw_parts_mut(buf, len);
            let outcome = match source.as_mut() {
                Some(src) => fill(src, &mut cursor, s, out),
                None => {
                    out.fill(0);
                    Fill::Full
                }
            };
            if let Err(e) = s.render.ReleaseBuffer(s.frames, 0) {
                on_event(ExclusiveEvent::Failed(format!("the audio device went away: {e}")));
                return;
            }
            match outcome {
                Fill::Full => {}
                // The next loop pass reopens at the new format.
                Fill::FormatChanged => {}
                Fill::Ended => {
                    source = None;
                    stream = None;
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use rodio::buffer::SamplesBuffer;
        use rodio::{ChannelCount, SampleRate};
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        /// The default device's shared-mode mix format — the one rate a device
        /// is all but guaranteed to accept exclusively too.
        fn native_format() -> (u32, u16) {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let device = resolve_device(None).unwrap();
                let client: IAudioClient = device.Activate(CLSCTX_ALL, None).unwrap();
                let mix = client.GetMixFormat().unwrap();
                let format = ((*mix).nSamplesPerSec, (*mix).nChannels);
                windows::Win32::System::Com::CoTaskMemFree(Some(mix as *const _));

                for rate in [44_100, 48_000, 96_000] {
                    match open_stream(&device, rate, format.1) {
                        Ok(s) => println!("{rate}: ok as {}", s.encoding.describe()),
                        Err(e) => println!("{rate}: {e}"),
                    }
                }
                format
            }
        }

        /// Talks to real hardware: opens the default output exclusively at
        /// its native format and plays half a second of silence through it.
        #[test]
        #[ignore = "opens the default audio device in exclusive mode"]
        fn plays_through_the_default_device() {
            let (rate, channels) = native_format();
            println!("native mix format: {rate} Hz, {channels} ch");
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink = events.clone();
            let output = ExclusiveOutput::open(None, move |e| {
                sink.lock().unwrap().push(match e {
                    ExclusiveEvent::Opened(f) => format!("opened {f}"),
                    ExclusiveEvent::Failed(f) => format!("failed {f}"),
                })
            })
            .expect("default device should resolve");
            println!("exclusive stereo rates: {:?}", output.stereo_rates());
            assert!(output.stereo_rates().contains(&rate));

            output.attach(Box::new(SamplesBuffer::new(
                ChannelCount::new(channels).unwrap(),
                SampleRate::new(rate).unwrap(),
                vec![0.0; rate as usize * channels as usize / 2],
            )));
            std::thread::sleep(Duration::from_millis(600));
            drop(output);

            let events = events.lock().unwrap();
            println!("{events:?}");
            assert!(
                events.first().is_some_and(|e| e.starts_with("opened")),
                "expected the stream to open: {events:?}"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Symphonia's own decode scaling, reproduced so the round trip is tested
    /// against what the decoder actually hands over.
    fn decode_i16(v: i16) -> f32 {
        v as f32 / 32_768.0
    }
    fn decode_i24(v: i32) -> f32 {
        v as f32 / 8_388_608.0
    }

    #[test]
    fn every_16_bit_value_round_trips_exactly() {
        let mut out = [0u8; 4];
        for v in i16::MIN..=i16::MAX {
            encode(decode_i16(v), Encoding::Int16, &mut out);
            assert_eq!(i16::from_le_bytes([out[0], out[1]]), v);
        }
    }

    #[test]
    fn every_24_bit_value_round_trips_exactly() {
        let mut out = [0u8; 4];
        // All 16.7 million values: this is the claim the feature rests on.
        for v in -8_388_608i32..=8_388_607 {
            encode(decode_i24(v), Encoding::Int24, &mut out);
            let back = i32::from_le_bytes([out[0], out[1], out[2], if out[2] & 0x80 != 0 { 0xFF } else { 0 }]);
            assert_eq!(back, v);
        }
    }

    /// A 16-bit file on a 24-bit device: zero padding, nothing else.
    #[test]
    fn a_16_bit_value_in_24_bits_is_only_padded() {
        let mut out = [0u8; 4];
        for v in [i16::MIN, -1, 0, 1, 12_345, i16::MAX] {
            encode(decode_i16(v), Encoding::Int24, &mut out);
            let back = i32::from_le_bytes([out[0], out[1], out[2], if out[2] & 0x80 != 0 { 0xFF } else { 0 }]);
            assert_eq!(back, (v as i32) << 8);
        }
    }

    #[test]
    fn the_32_bit_container_left_justifies() {
        let mut out = [0u8; 4];
        encode(decode_i24(-1), Encoding::Int24In32, &mut out);
        assert_eq!(i32::from_le_bytes(out), -256);
        encode(decode_i24(8_388_607), Encoding::Int24In32, &mut out);
        assert_eq!(i32::from_le_bytes(out), 8_388_607 << 8);
    }

    #[test]
    fn out_of_range_samples_clip_instead_of_wrapping() {
        let mut out = [0u8; 4];
        encode(1.5, Encoding::Int16, &mut out);
        assert_eq!(i16::from_le_bytes([out[0], out[1]]), i16::MAX);
        encode(-1.5, Encoding::Int16, &mut out);
        assert_eq!(i16::from_le_bytes([out[0], out[1]]), i16::MIN);
    }

    #[test]
    fn float_is_written_verbatim() {
        let mut out = [0u8; 4];
        encode(0.123_456_7, Encoding::Float32, &mut out);
        assert_eq!(f32::from_le_bytes(out), 0.123_456_7);
    }

    #[test]
    fn a_supported_rate_is_used_as_is() {
        assert_eq!(pick_rate(96_000, &[44_100, 96_000]), Some(96_000));
    }

    /// The case found on real hardware: a device that only takes 44.1 kHz.
    #[test]
    fn falls_back_to_the_only_rate_there_is() {
        assert_eq!(pick_rate(48_000, &[44_100]), Some(44_100));
        assert_eq!(pick_rate(192_000, &[44_100]), Some(44_100));
    }

    #[test]
    fn stays_in_the_same_rate_family() {
        let supported = [44_100, 48_000, 88_200];
        // 96k → 48k (exact halving) beats 88.2k, even though 88.2k is higher.
        assert_eq!(pick_rate(96_000, &supported), Some(48_000));
        assert_eq!(pick_rate(176_400, &supported), Some(88_200));
    }

    #[test]
    fn upsamples_within_the_family_before_downsampling() {
        assert_eq!(pick_rate(44_100, &[48_000, 88_200, 96_000]), Some(88_200));
    }

    #[test]
    fn crosses_families_only_when_it_must() {
        assert_eq!(pick_rate(44_100, &[48_000, 96_000]), Some(48_000));
        assert_eq!(pick_rate(44_100, &[]), None);
    }

    #[test]
    fn formats_describe_themselves() {
        assert_eq!(describe_format(44_100, 2, Encoding::Int24), "44.1 kHz · 24-bit · 2 ch");
        assert_eq!(describe_format(96_000, 2, Encoding::Int16), "96 kHz · 16-bit · 2 ch");
    }
}
