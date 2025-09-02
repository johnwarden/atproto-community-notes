import { envToCfg, readEnv } from '../config'
import { NotesService } from '../index'

const run = async () => {
  const env = readEnv()

  const cfg = envToCfg(env)

  const server = await NotesService.create(cfg)

  await server.start()
}

run()
