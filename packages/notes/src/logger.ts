import { type IncomingMessage } from 'node:http'
import { type Logger, stdSerializers } from 'pino'
import { pinoHttp } from 'pino-http'
import { obfuscateHeaders, subsystemLogger } from '@atproto/common'

export const appLogger: Logger = subsystemLogger('notes')

export function reqSerializer(req: IncomingMessage) {
  const serialized = stdSerializers.req(req)
  const headers = obfuscateHeaders(serialized.headers)
  return { ...serialized, headers }
}

export const httpLogger: Logger = subsystemLogger('notes:http')

export const loggerMiddleware = pinoHttp({
  logger: httpLogger,
  serializers: {
    req: reqSerializer,
    err: (err: unknown) => ({
      code: err?.['code'],
      message: err?.['message'],
    }),
  },
})
