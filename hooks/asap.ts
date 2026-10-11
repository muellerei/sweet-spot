// What `/sweet-spot asap` makes of the context it is typed at. Pure: the command reads the session and keeps what comes back, so that the
// answer and the pause judge from the one mark.

import type { Config } from './config'
import type { Asap } from './decide'

// The mark and the answer at a known context. An answer that is running ends in a pause, and that pause hands over.
export const asapFor = (config: Config, tokens: number): { asap: Asap; text: string; lines: string[] } => ({
  asap: { from: tokens },
  text: `${config.dryRun ? 'dry run, would hand over' : 'hands over'} at the next pause, context ${tokens} tokens`,
  lines: [`asap: set at context ${tokens}`],
})

// The debug line for a mark that a shrunken context ended, at a pause.
export const ASAP_OVER = 'asap: over, the context shrank below where it was asked'

// What the answer adds at rest when the last stop is not known (after /clear, or an Esc with no stop): the mod does not hand over blind.
export const RUNNING_UNKNOWN = 'what is running is not known until the next answer'
