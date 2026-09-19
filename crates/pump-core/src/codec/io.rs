use crate::model::{NodeId, PlanError};

pub(super) fn length(value: usize) -> Result<u32, PlanError> {
    u32::try_from(value).map_err(|_| PlanError::Overflow)
}

pub(super) fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}
pub(super) fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

pub(super) fn put_string(out: &mut Vec<u8>, value: &str) -> Result<(), PlanError> {
    put_u32(out, length(value.len())?);
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

pub(super) fn put_ids(out: &mut Vec<u8>, ids: &[NodeId]) -> Result<(), PlanError> {
    put_u32(out, length(ids.len())?);
    for id in ids {
        put_u32(out, id.0);
    }
    Ok(())
}

pub(super) struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
    string_bytes: u32,
    string_limit: u32,
}

impl<'a> Reader<'a> {
    pub(super) const fn new(bytes: &'a [u8], string_limit: u32) -> Self {
        Self {
            bytes,
            offset: 0,
            string_bytes: 0,
            string_limit,
        }
    }
    pub(super) const fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    pub(super) fn take(&mut self, count: usize) -> Result<&'a [u8], PlanError> {
        let end = self.offset.checked_add(count).ok_or(PlanError::Overflow)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(PlanError::InvalidFormat("truncated"))?;
        self.offset = end;
        Ok(value)
    }

    pub(super) fn byte(&mut self) -> Result<u8, PlanError> {
        self.take(1)?
            .first()
            .copied()
            .ok_or(PlanError::InvalidFormat("byte"))
    }

    pub(super) fn u16(&mut self) -> Result<u16, PlanError> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| PlanError::InvalidFormat("u16"))?;
        Ok(u16::from_le_bytes(bytes))
    }

    pub(super) fn u32(&mut self) -> Result<u32, PlanError> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| PlanError::InvalidFormat("u32"))?;
        Ok(u32::from_le_bytes(bytes))
    }

    pub(super) fn string(&mut self) -> Result<String, PlanError> {
        let count = usize::try_from(self.u32()?).map_err(|_| PlanError::Overflow)?;
        if count > crate::MAX_STRING_BYTES {
            return Err(PlanError::InvalidFormat("string length"));
        }
        let count_u32 = u32::try_from(count).map_err(|_| PlanError::Overflow)?;
        self.string_bytes = self
            .string_bytes
            .checked_add(count_u32)
            .ok_or(PlanError::Overflow)?;
        if self.string_bytes > self.string_limit {
            return Err(PlanError::StringBudget {
                limit: self.string_limit,
            });
        }
        String::from_utf8(self.take(count)?.to_vec()).map_err(|_| PlanError::InvalidFormat("utf8"))
    }

    pub(super) fn id(&mut self, next: u32) -> Result<NodeId, PlanError> {
        let id = self.u32()?;
        if id >= next {
            return Err(PlanError::ForwardReference {
                referenced: id,
                next,
            });
        }
        Ok(NodeId(id))
    }

    pub(super) fn ids(&mut self, next: u32, edges: &mut u32) -> Result<Vec<NodeId>, PlanError> {
        let count = self.u32()?;
        if count == 0 || count > 4096 {
            return Err(PlanError::InvalidFormat("child count"));
        }
        take_edges(edges, count)?;
        (0..count).map(|_| self.id(next)).collect()
    }
}

pub(super) fn take_edges(remaining: &mut u32, count: u32) -> Result<(), PlanError> {
    *remaining = remaining
        .checked_sub(count)
        .ok_or(PlanError::EdgeBudget { limit: 16_384 })?;
    Ok(())
}
