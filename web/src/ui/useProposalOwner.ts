import { useCallback, useState } from "react"

import type { ChartProposal } from "../../shared/index.ts"

export function useProposalOwner(
  initial: readonly ChartProposal[],
  applyProposal: (proposal: ChartProposal) => Promise<void>,
  discardProposal: (proposal: ChartProposal) => Promise<void>,
) {
  const [proposals, setProposals] = useState(initial)
  const addProposal = useCallback((proposal: ChartProposal) => {
    setProposals((current) => [proposal, ...current.filter((item) => item.id !== proposal.id)])
  }, [])

  return {
    proposals,
    addProposal,
    async apply(proposal: ChartProposal): Promise<void> {
      await applyProposal(proposal)
      setProposals((current) => current.filter((item) => item.id !== proposal.id))
    },
    async discard(proposal: ChartProposal): Promise<void> {
      await discardProposal(proposal)
      setProposals((current) => current.filter((item) => item.id !== proposal.id))
    },
  }
}
