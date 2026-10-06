import { homedir } from 'node:os'
import { join } from 'node:path'

const home = homedir()
const claude = join(home, '.claude')
const deck = join(claude, 'session-deck')

export const PATHS = {
  home,
  projects: join(claude, 'projects'),
  sessions: join(claude, 'sessions'),
  claudeSettings: join(claude, 'settings.json'),
  deck,
  tee: join(deck, 'status'),
  teeScript: join(deck, 'statusline-tee.sh'),
  teeOriginal: join(deck, 'statusline-original.json'),
  warpConfig: join(home, '.warp', 'launch_configurations', 'session-deck-resume.yaml'),
} as const
