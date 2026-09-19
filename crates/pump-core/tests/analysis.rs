use pump_core::{Builder, Limits, analyze, compile};

#[test]
fn analysis_reports_uncalibrated_structural_counts() {
    // Given
    let mut builder = Builder::new(Limits::default());
    let tap = builder.tap(0b11, 3, "tap", "source").expect("tap");
    let runtime = compile(&builder.finish(tap).expect("plan")).expect("compile");

    // When
    let report = analyze(&runtime).expect("analysis");

    // Then
    assert_eq!(report.node_count, 1);
    assert_eq!(report.root_expansion_bound, 1);
    assert_eq!(report.root_duration_ticks, 3);
    assert_eq!(report.declared_tap_node_count, 1);
    assert_eq!(report.declared_choice_node_count, 0);
    assert_eq!(report.provenance_sites, 1);
    assert_eq!(report.max_declared_tap_mask_width, 2);
}
