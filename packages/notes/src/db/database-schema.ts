import { Kysely } from 'kysely'
import * as pendingLabels from './tables/pendingLabels'
import * as record from './tables/record'
import * as score from './tables/score'
import * as scoreEvent from './tables/scoreEvent'

/**
 * Notes Database Schema (notes.db)
 *
 * Contains all Community Notes data:
 * - Proposals (community notes)
 * - Votes/ratings on proposals
 * - Score events from algorithm runs
 * - Current scores (maintained by triggers)
 * - Pending labels (for external labeler sync)
 */
export type DatabaseSchemaType = record.PartialDB &
  scoreEvent.PartialDB &
  score.PartialDB &
  pendingLabels.PartialDB

export type DatabaseSchema = Kysely<DatabaseSchemaType>
