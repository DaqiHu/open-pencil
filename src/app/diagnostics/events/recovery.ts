import * as v from 'valibot'

import { recordDiagnostic } from '../recorder'
import type { DiagnosticLevel } from '../types'

const recoveryOperationSchema = v.object({
  operation: v.picklist([
    'persist',
    'mark-closed',
    'adopt',
    'reset-source',
    'store',
    'close-tab',
    'restore',
    'restore-handle',
    'prepare-reload'
  ]),
  outcome: v.picklist(['ok', 'failed', 'timeout', 'fallback', 'skipped']),
  documentName: v.optional(v.nullable(v.string())),
  detail: v.optional(v.nullable(v.string())),
  errorName: v.optional(v.nullable(v.string())),
  suppressed: v.optional(v.nullable(v.boolean())),
  count: v.optional(v.nullable(v.number()))
})

type RecoveryOperationInput = v.InferOutput<typeof recoveryOperationSchema>

const outcomeLevels: Record<RecoveryOperationInput['outcome'], DiagnosticLevel> = {
  ok: 'info',
  failed: 'error',
  timeout: 'warning',
  fallback: 'warning',
  skipped: 'debug'
}

/**
 * Records a recovery/tab-lifecycle operation so silent stalls (a hung snapshot
 * write blocking tab close, a dropped restore) are visible after the fact.
 * Callers skip chatty successes such as routine snapshot writes.
 */
export function recordRecoveryOperation(input: RecoveryOperationInput): void {
  const parsed = v.safeParse(recoveryOperationSchema, input)
  if (!parsed.success) return
  recordDiagnostic({
    category: 'recovery',
    level: outcomeLevels[parsed.output.outcome],
    name: `recovery.${parsed.output.operation}.${parsed.output.outcome}`,
    attributes: {
      operation: parsed.output.operation,
      outcome: parsed.output.outcome,
      documentName: parsed.output.documentName ?? null,
      detail: parsed.output.detail ?? null,
      errorName: parsed.output.errorName ?? null,
      suppressed: parsed.output.suppressed ?? null,
      count: parsed.output.count ?? null
    }
  })
}
