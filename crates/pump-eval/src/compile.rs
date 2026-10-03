use std::collections::BTreeMap;
use std::fmt::Write as _;

use pump_chart::{
    CandidateId, Fraction, Limits, Plan, RuntimeProgram, WeightedChart, build_runtime,
    candidate_id, enumerate,
};
use sha2::{Digest, Sha256};

use crate::{
    CandidateReport, Certificate, Compilation, CompileError, CompileReport, DistributionReport,
    EvalContract, REPORT_SCHEMA_VERSION, VerifyError, assess,
};

const CERTIFICATE_DOMAIN: &[u8] = b"pump-eval-v2-exact-certificate\0";

pub fn compile(
    plan: &Plan,
    contract: &EvalContract,
    limits: &Limits,
) -> Result<Compilation, CompileError> {
    contract.validate()?;
    let enumeration = enumerate(plan, limits)?;
    let merged = merge_derivations(enumeration.derivations)?;
    let mut reports = Vec::with_capacity(merged.len());
    let mut retained = Vec::new();
    let mut retained_mass = Fraction::ZERO;
    let mut rejected_mass = Fraction::ZERO;
    for (id, weighted) in merged {
        let assessment = assess(&weighted.chart, &plan.music, contract)?;
        let candidate_mass = weighted.prior_mass;
        let accepted_mass = if assessment.accepted {
            candidate_mass
        } else {
            Fraction::ZERO
        };
        if assessment.accepted {
            retained_mass = add(retained_mass, candidate_mass)?;
            retained.push(weighted);
        } else {
            rejected_mass = add(rejected_mass, candidate_mass)?;
        }
        reports.push(CandidateReport {
            candidate_id: id_string(id),
            original_mass: candidate_mass,
            retained_mass: accepted_mass,
            assessment,
        });
    }
    let retained_candidates =
        u32::try_from(retained.len()).map_err(|_| CompileError::ProbabilityArithmetic)?;
    let unique_candidates =
        u32::try_from(reports.len()).map_err(|_| CompileError::ProbabilityArithmetic)?;
    let distribution = DistributionReport {
        original_mass: enumeration.total_prior_mass,
        retained_mass,
        rejected_mass,
        unique_candidates,
        retained_candidates,
    };
    if retained.is_empty() {
        return Err(CompileError::NoRetainedCandidates(Box::new(
            crate::FailedCompilation {
                distribution,
                candidates: reports,
            },
        )));
    }
    let runtime = build_runtime(plan.music.clone(), &retained, contract.history_policy)?;
    let covered_candidate_ids = runtime
        .candidates
        .iter()
        .map(|candidate| id_string(candidate.id))
        .collect();
    let mut report = CompileReport {
        schema_version: REPORT_SCHEMA_VERSION,
        contract: contract.clone(),
        distribution,
        candidates: reports,
        certificate: Certificate {
            scheme: "pump-eval-v2-exact-within-finite-model".into(),
            exact_within_model: true,
            covered_candidate_ids,
            report_digest: String::new(),
        },
    };
    report.certificate.report_digest = report_digest(&runtime, &report)?;
    Ok(Compilation { runtime, report })
}

pub fn reproduce(
    plan: &Plan,
    contract: &EvalContract,
    limits: &Limits,
    expected_runtime: &RuntimeProgram,
    expected_report: &CompileReport,
) -> Result<Compilation, VerifyError> {
    let compilation = compile(plan, contract, limits)?;
    if compilation.runtime != *expected_runtime {
        return Err(VerifyError::RuntimeMismatch);
    }
    if compilation.report != *expected_report {
        return Err(VerifyError::ReportMismatch);
    }
    Ok(compilation)
}

fn merge_derivations(
    derivations: Vec<pump_chart::Derivation>,
) -> Result<BTreeMap<CandidateId, WeightedChart>, CompileError> {
    let mut merged = BTreeMap::<CandidateId, WeightedChart>::new();
    for derivation in derivations {
        let id = candidate_id(&derivation.chart).map_err(pump_chart::RuntimeError::from)?;
        match merged.get_mut(&id) {
            Some(existing) if existing.chart == derivation.chart => {
                existing.prior_mass = add(existing.prior_mass, derivation.prior_mass)?;
            }
            Some(_) => return Err(CompileError::DigestCollision),
            None => {
                merged.insert(
                    id,
                    WeightedChart {
                        chart: derivation.chart,
                        prior_mass: derivation.prior_mass,
                    },
                );
            }
        }
    }
    Ok(merged)
}

fn add(left: Fraction, right: Fraction) -> Result<Fraction, CompileError> {
    left.checked_add(right)
        .map_err(|_| CompileError::ProbabilityArithmetic)
}

fn id_string(id: CandidateId) -> String {
    let mut output = String::with_capacity(64);
    for byte in id.0 {
        let _ = write!(output, "{byte:02x}");
    }
    output
}

fn report_digest(runtime: &RuntimeProgram, report: &CompileReport) -> Result<String, CompileError> {
    let mut hasher = Sha256::new();
    hasher.update(CERTIFICATE_DOMAIN);
    hasher.update(pump_chart::encode_runtime_program(runtime)?);
    hasher.update(serde_json::to_vec(report)?);
    let digest: [u8; 32] = hasher.finalize().into();
    let mut output = String::with_capacity(64);
    for byte in digest {
        let _ = write!(output, "{byte:02x}");
    }
    Ok(output)
}
