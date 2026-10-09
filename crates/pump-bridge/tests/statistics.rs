use pump_bridge::BridgeStatistics;

#[test]
fn statistics_accept_known_fields() -> Result<(), serde_json::Error> {
    let json = r#"{
        "source_derivations": 2,
        "unique_charts": 1,
        "total_prior_mass": { "numerator": 1, "denominator": 1 },
        "work": 10
    }"#;

    let statistics = serde_json::from_str::<BridgeStatistics>(json)?;

    assert_eq!(statistics.source_derivations, 2);
    Ok(())
}

#[test]
fn statistics_reject_unknown_fields() {
    let json = r#"{
        "source_derivations": 2,
        "unique_charts": 1,
        "total_prior_mass": { "numerator": 1, "denominator": 1 },
        "work": 10,
        "unexpected": true
    }"#;

    let result = serde_json::from_str::<BridgeStatistics>(json);

    assert!(result.is_err());
}
