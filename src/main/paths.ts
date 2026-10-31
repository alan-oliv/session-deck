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
  fileHistory: join(claude, 'file-history'),
  sessionEnv: join(claude, 'session-env'),
  debug: join(claude, 'debug'),
  deck,
  tee: join(deck, 'status'),
  teeScript: join(deck, 'statusline-tee.sh'),
  teeOriginal: join(deck, 'statusline-original.json'),
  warpConfig: join(home, '.warp', 'tab_configs', 'session_deck_resume.toml'),
} as const
