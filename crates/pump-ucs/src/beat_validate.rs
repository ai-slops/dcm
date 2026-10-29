use crate::beat::{Beat, BeatUcsChart, gcd};
use crate::{UcsError, UcsMode};

pub(crate) fn validate_for_render(chart: &BeatUcsChart) -> Result<(), UcsError> {
    if chart.duration.numerator() == 0 || chart.notes.len() > 10_000 {
        return Err(UcsError::Unrepresentable("chart bounds are invalid"));
    }
    if chart.tempo.first().map(|segment| segment.at) != Some(Beat::new(0, 1)?)
        || chart.grid_sections.first().map(|section| section.at) != Some(Beat::new(0, 1)?)
    {
        return Err(UcsError::Unrepresentable(
            "tempo and grid must start at beat zero",
        ));
    }
    validate_markers(chart)?;
    validate_notes(chart)?;
    if !chart.reference_accents.is_empty() {
        return Err(UcsError::Unrepresentable(
            "UCS cannot represent reference accents",
        ));
    }
    for section in &chart.grid_sections {
        if section.rows_per_measure == 0 {
            return Err(UcsError::Unrepresentable(
                "rows_per_measure must be positive",
            ));
        }
        ucs_split(section.rows_per_measure)?;
    }
    Ok(())
}

pub(crate) fn ucs_split(rows_per_measure: u16) -> Result<u16, UcsError> {
    let divisor =
        u16::try_from(gcd(4, u64::from(rows_per_measure))).map_err(|_| UcsError::Overflow)?;
    let split = rows_per_measure / divisor;
    if split > 128 {
        return Err(UcsError::Unrepresentable(
            "local grid cannot refine to UCS Split <= 128",
        ));
    }
    Ok(split)
}

fn validate_markers(chart: &BeatUcsChart) -> Result<(), UcsError> {
    if chart.tempo.len() > 4_096 || chart.grid_sections.len() > 4_096 {
        return Err(UcsError::Unrepresentable("section count exceeds 4096"));
    }
    for (index, segment) in chart.tempo.iter().enumerate() {
        if segment.at >= chart.duration
            || index > 0 && segment.at <= chart.tempo[index - 1].at
            || segment.micros_per_beat.numerator() == 0
        {
            return Err(UcsError::Unrepresentable(
                "tempo markers must be positive, strictly ordered, and before duration",
            ));
        }
    }
    for (index, section) in chart.grid_sections.iter().enumerate() {
        if section.at >= chart.duration
            || index > 0 && section.at <= chart.grid_sections[index - 1].at
        {
            return Err(UcsError::Unrepresentable(
                "grid markers must be strictly ordered and before duration",
            ));
        }
    }
    Ok(())
}

fn validate_notes(chart: &BeatUcsChart) -> Result<(), UcsError> {
    let allowed_mask = match chart.mode {
        UcsMode::Single => 0x001f,
        UcsMode::Double => 0x03ff,
    };
    let mut active_until = [None; 10];
    let mut previous: Option<&crate::beat::BeatNote> = None;
    for note in &chart.notes {
        let end = note.at.checked_add(note.hold)?;
        if note.panel_mask == 0
            || note.panel_mask & !allowed_mask != 0
            || note.at >= chart.duration
            || end >= chart.duration
        {
            return Err(UcsError::Unrepresentable(
                "notes must use valid panels and lie before duration",
            ));
        }
        if let Some(prior) = previous
            && ((prior.at, prior.hold, prior.panel_mask) >= (note.at, note.hold, note.panel_mask)
                || prior.at == note.at && prior.hold == note.hold)
        {
            return Err(UcsError::Unrepresentable(
                "notes must be canonical and merge shared onset/hold values",
            ));
        }
        for (lane, active) in active_until.iter_mut().enumerate().take(chart.mode.lanes()) {
            let mask = 1_u16 << u32::try_from(lane).map_err(|_| UcsError::Overflow)?;
            if note.panel_mask & mask == 0 {
                continue;
            }
            if active.is_some_and(|end: Beat| end >= note.at) {
                return Err(UcsError::Unrepresentable(
                    "panel demands overlap or collide with a hold tail",
                ));
            }
            *active = Some(end);
        }
        previous = Some(note);
    }
    Ok(())
}
