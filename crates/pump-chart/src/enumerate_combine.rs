use crate::enumerate::{Context, Trace};
use crate::{EnumerateError, Note};

impl Context<'_> {
    pub(crate) fn combine(
        &mut self,
        left: &[Trace],
        right: &[Trace],
        sequence: bool,
    ) -> Result<Vec<Trace>, EnumerateError> {
        let capacity = left
            .len()
            .checked_mul(right.len())
            .ok_or(EnumerateError::LimitExceeded("derivations"))?;
        self.check_derivations(capacity)?;
        let mut output = Vec::with_capacity(capacity);
        for first in left {
            for second in right {
                self.add_work(1)?;
                let offset = if sequence { first.span } else { 0 };
                let span = if sequence {
                    first
                        .span
                        .checked_add(second.span)
                        .ok_or(EnumerateError::LimitExceeded("span"))?
                } else {
                    first.span.max(second.span)
                };
                let mut notes = first.notes.clone();
                for note in &second.notes {
                    notes.push(Note {
                        tick: note
                            .tick
                            .checked_add(offset)
                            .ok_or(EnumerateError::LimitExceeded("tick"))?,
                        panel_mask: note.panel_mask,
                        hold_ticks: note.hold_ticks,
                    });
                }
                if notes.len() > usize::try_from(self.limits.max_trace_notes).unwrap_or(usize::MAX)
                {
                    return Err(EnumerateError::LimitExceeded("trace notes"));
                }
                self.add_events(notes.len())?;
                let mut decisions = first.decisions.clone();
                decisions.extend_from_slice(&second.decisions);
                output.push(Trace {
                    span,
                    notes,
                    mass: first.mass.checked_mul(second.mass)?,
                    decisions,
                });
            }
        }
        Ok(output)
    }

    pub(crate) fn check_derivations(&self, count: usize) -> Result<(), EnumerateError> {
        if count > usize::try_from(self.limits.max_derivations).unwrap_or(usize::MAX) {
            Err(EnumerateError::LimitExceeded("derivations"))
        } else {
            Ok(())
        }
    }

    pub(crate) fn add_work(&mut self, count: u64) -> Result<(), EnumerateError> {
        self.work = self
            .work
            .checked_add(count)
            .ok_or(EnumerateError::LimitExceeded("work"))?;
        if self.work > self.limits.max_work {
            Err(EnumerateError::LimitExceeded("work"))
        } else {
            Ok(())
        }
    }

    pub(crate) fn add_events(&mut self, count: usize) -> Result<(), EnumerateError> {
        self.events = self
            .events
            .checked_add(u64::try_from(count).map_err(|_| EnumerateError::LimitExceeded("events"))?)
            .ok_or(EnumerateError::LimitExceeded("events"))?;
        if self.events > self.limits.max_total_events {
            Err(EnumerateError::LimitExceeded("events"))
        } else {
            Ok(())
        }
    }
}
