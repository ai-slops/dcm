use pump_chart::{Fraction, Note, song_time};
use pump_ucs::{UcsMode, parse_ucs};

const BASIC: &str = ":Format=1\r\n:Mode=Single\r\n:BPM=120\r\n:Delay=125\r\n:Beat=4\r\n:Split=4\r\nX....\r\n.M...\r\n.H...\r\n.W...\r\n";

#[test]
fn parse_preserves_exact_timing_and_holds() {
    let parsed = parse_ucs(BASIC.as_bytes(), [7; 32]).expect("valid UCS");

    assert_eq!(parsed.mode, UcsMode::Single);
    assert_eq!(parsed.chart.ticks_per_beat, 4);
    assert_eq!(parsed.chart.span_ticks, 4);
    assert_eq!(
        parsed.chart.notes,
        vec![
            Note {
                tick: 0,
                panel_mask: 1,
                hold_ticks: 0
            },
            Note {
                tick: 1,
                panel_mask: 2,
                hold_ticks: 2
            },
        ]
    );
    assert_eq!(parsed.music.offset_micros, 125_000);
    assert_eq!(
        parsed.music.tempo[0].micros_per_beat,
        Fraction::new(500_000, 1).expect("fraction")
    );
    assert_eq!(parsed.music.audio_sha256, [7; 32]);
    let row_zero = song_time(&parsed.music, 0).expect("row zero time");
    let row_one = song_time(&parsed.music, 1).expect("row one time");
    assert!(!row_zero.negative);
    assert_eq!(
        row_zero.magnitude,
        Fraction::new(125_000, 1).expect("fraction")
    );
    assert!(!row_one.negative);
    assert_eq!(
        row_one.magnitude,
        Fraction::new(250_000, 1).expect("fraction")
    );
}

#[test]
fn parse_accepts_bom_variable_split_and_large_chords() {
    let mut input = String::from(
        "\u{feff}:Format=1\r\n:Mode=Double\r\n:BPM=120\r\n:Beat=4\r\n:Split=2\r\n..........\r\n:Split=4\r\nXXXXXXXXXX\r\n",
    );
    let parsed = parse_ucs(input.as_bytes(), [0; 32]).expect("BOM and variable split");
    assert_eq!(parsed.chart.ticks_per_beat, 4);
    assert_eq!(parsed.chart.span_ticks, 3);
    assert_eq!(parsed.chart.notes.len(), 1);
    assert_eq!(parsed.chart.notes[0].panel_mask, 0x03ff);

    input = String::from(":Format=1\n:Mode=Double\n:BPM=120\n:Beat=4\n:Split=4\n");
    for _ in 0..1_001 {
        input.push_str("XXXXXXXXXX\n");
    }
    let parsed = parse_ucs(input.as_bytes(), [0; 32]).expect("canonical chord bound");
    assert_eq!(parsed.chart.notes.len(), 1_001);
}

#[test]
fn parse_inherits_grid_and_preserves_cross_section_hold() {
    let input = b":Format=1\n:Mode=Double\n:BPM=120\n:Beat=4\n:Split=2\nM.........\n:BPM=150\nH.........\nW.........\n";

    let parsed = parse_ucs(input, [0; 32]).expect("valid UCS");

    assert_eq!(parsed.chart.ticks_per_beat, 2);
    assert_eq!(
        parsed.chart.notes,
        vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 2
        }]
    );
    assert_eq!(parsed.music.tempo.len(), 2);
    assert_eq!(parsed.music.tempo[1].start_tick, 1);
}

#[test]
fn parse_rejects_malformed_or_unrepresentable_inputs() {
    for input in [
        ":Format=3\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=4\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=4\nH....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=4\nM....\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:Delay=0\n:Beat=4\n:Split=4\n.....\n:BPM=120\n:Delay=1\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120.1234567\n:Beat=4\n:Split=4\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:BPM=121\n:Beat=4\n:Split=4\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:Delay=-+1\n:Beat=4\n:Split=4\n.....\n",
        ":Format=1\n:Mode=Single\n:BPM=120\n:Delay=9007199254741\n:Beat=4\n:Split=4\n.....\n",
        ":Format=1\r:Mode=Single\r:BPM=120\r:Beat=4\r:Split=4\r.....\r",
        ":Format=1\r\r\n:Mode=Single\r\n:BPM=120\r\n:Beat=4\r\n:Split=4\r\n.....\r\n",
        ":Format=1\n:Mode=Single\n.....\n",
    ] {
        assert!(
            parse_ucs(input.as_bytes(), [0; 32]).is_err(),
            "accepted {input:?}"
        );
    }
    assert!(parse_ucs(&[0xff, 0xfe, b':', 0], [0; 32]).is_err());
}

#[test]
fn parse_error_display_has_stable_ucs_prefix() {
    let error = parse_ucs(b":Format=3\n", [0; 32]).expect_err("format must be rejected");

    assert!(error.to_string().starts_with("UCS "));
}
