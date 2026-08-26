import type { FlowId } from '@activepieces/core-utils'
import type { FastifyBaseLogger } from 'fastify'
import { distributedLock } from '../../database/redis-connections'

const FLOW_VERSION_MUTATION_LOCK_TIMEOUT_SECONDS = 120

function flowVersionMutationLockKey(flowId: FlowId): string {
    return `flow-version-mutation-${flowId}`
}

async function withFlowVersionMutationLock<T>({ log, flowId, fn }: {
    log: FastifyBaseLogger
    flowId: FlowId
    fn: () => Promise<T>
}): Promise<T> {
    return distributedLock(log).runExclusive({
        key: flowVersionMutationLockKey(flowId),
        timeoutInSeconds: FLOW_VERSION_MUTATION_LOCK_TIMEOUT_SECONDS,
        fn,
    })
}

export { flowVersionMutationLockKey, withFlowVersionMutationLock }
