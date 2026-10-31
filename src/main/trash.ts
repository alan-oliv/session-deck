import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { TRASH_BLOCKED, type Session } from '../shared/api'
import { PATHS } from './paths'

export type TrashDirs = Pick<typeof PATHS, 'fileHistory' | 'sessionEnv' | 'debug' | 'tee'>

export const NOT_ARCHIVED = 'Only archived sessions can be moved to the Trash.'

// Transcript first: once it's gone, Claude Code and the deck stop listing the session whatever else is left.
export const sessionPaths = (transcript: string, id: string, dirs: TrashDirs = PATHS): string[] =>
  [transcript, join(dirname(transcript), id), join(dirs.fileHistory, id), join(dirs.sessionEnv, id), join(dirs.debug, `${id}.txt`), join(dirs.tee, `${id}.json`)]
    .filter((p) => existsSync(p))

export async function trashSessionFiles(paths: string[], trash: (p: string) => Promise<void>): Promise<string[]> {
  const [first, ...rest] = paths
  if (first) await trash(first)
  const left: string[] = []
  for (const p of rest) {
    try {
      await trash(p)
    } catch {
      left.push(p)
    }
  }
  return left
}

export function checkTrashable(sessions: Pick<Session, 'archived' | 'live'>[]): void {
  if (!sessions.every((s) => s.archived)) throw new Error(NOT_ARCHIVED)
  if (sessions.some((s) => s.live)) throw new Error(TRASH_BLOCKED)
}

// `onTrashed` hears each session as its files go, so the caller can forget it even when a later one fails.
export async function trashSessionsTo(
  sessions: Pick<Session, 'id'>[], pathOf: (id: string) => string | undefined, trash: (p: string) => Promise<void>, onTrashed: (id: string) => void, dirs: TrashDirs = PATHS,
): Promise<void> {
  const left: string[] = []
  for (const [i, s] of sessions.entries()) {
    try {
      const transcript = pathOf(s.id)
      if (!transcript) throw new Error('Unknown session')
      left.push(...(await trashSessionFiles(sessionPaths(transcript, s.id, dirs), trash)))
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      throw new Error(i ? `Moved ${i} of ${sessions.length} sessions to the Trash. ${why}` : why)
    }
    onTrashed(s.id)
  }
  const n = sessions.length
  if (left.length) throw new Error(`Moved ${n} session${n === 1 ? '' : 's'} to the Trash, but couldn't trash: ${left.join(', ')}`)
}

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest
  const id = 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1'
  const id2 = '5d0e2b7c-1f3a-4c89-b6d4-9e8a7f6c5b21'
  // A temp folder stands in for ~/.claude: `id` has every file a session can leave, `id2` only a transcript.
  const fixture = () => {
    const claude = mkdtempSync(join(tmpdir(), 'deck-trash-'))
    const dirs: TrashDirs = {
      fileHistory: join(claude, 'file-history'), sessionEnv: join(claude, 'session-env'), debug: join(claude, 'debug'), tee: join(claude, 'session-deck', 'status'),
    }
    const project = join(claude, 'projects', '-r-app')
    for (const d of [join(project, id, 'subagents'), join(dirs.fileHistory, id), join(dirs.sessionEnv, id), dirs.debug, dirs.tee]) mkdirSync(d, { recursive: true })
    const transcript = join(project, `${id}.jsonl`)
    for (const f of [transcript, join(project, `${id2}.jsonl`), join(dirs.debug, `${id}.txt`), join(dirs.tee, `${id}.json`)]) writeFileSync(f, '{}\n')
    const bin = mkdtempSync(join(tmpdir(), 'deck-bin-'))
    const trashed: string[] = []
    // Stands in for shell.trashItem: moves each path out of the folder, refusing the ones listed.
    const trashExcept = (...refuse: string[]) => async (p: string) => {
      if (refuse.includes(p)) throw new Error(`EACCES: ${p}`)
      renameSync(p, join(bin, `${trashed.length}-${basename(p)}`))
      trashed.push(p)
    }
    return { dirs, project, transcript, trashed, trashExcept }
  }

  it('lists the files a session left that still exist, transcript first', () => {
    const { dirs, project, transcript } = fixture()
    rmSync(join(dirs.sessionEnv, id), { recursive: true })
    expect(sessionPaths(transcript, id, dirs)).toEqual([
      transcript, join(project, id), join(dirs.fileHistory, id), join(dirs.debug, `${id}.txt`), join(dirs.tee, `${id}.json`),
    ])
    expect(sessionPaths(join(project, `${id2}.jsonl`), id2, dirs)).toEqual([join(project, `${id2}.jsonl`)])
  })
  it('trashes every file of a session', async () => {
    const { dirs, transcript, trashed, trashExcept } = fixture()
    const paths = sessionPaths(transcript, id, dirs)
    expect(paths).toHaveLength(6)
    expect(await trashSessionFiles(paths, trashExcept())).toEqual([])
    expect(trashed).toEqual(paths)
    expect(paths.filter((p) => existsSync(p))).toEqual([])
  })
  it("touches nothing else when the transcript can't be trashed", async () => {
    const { dirs, transcript, trashed, trashExcept } = fixture()
    const paths = sessionPaths(transcript, id, dirs)
    await expect(trashSessionFiles(paths, trashExcept(transcript))).rejects.toThrow(/EACCES/)
    expect(trashed).toEqual([])
    expect(paths.every((p) => existsSync(p))).toBe(true)
  })
  it("keeps going when another file can't be trashed, and returns it", async () => {
    const { dirs, transcript, trashed, trashExcept } = fixture()
    const paths = sessionPaths(transcript, id, dirs)
    const stuck = join(dirs.fileHistory, id)
    expect(await trashSessionFiles(paths, trashExcept(stuck))).toEqual([stuck])
    expect(trashed).toEqual(paths.filter((p) => p !== stuck))
  })
  it('refuses sessions that are not archived, then running ones', () => {
    expect(() => checkTrashable([{ archived: true, live: false }, { archived: false, live: false }])).toThrow(NOT_ARCHIVED)
    expect(() => checkTrashable([{ archived: false, live: true }])).toThrow(NOT_ARCHIVED)
    expect(() => checkTrashable([{ archived: true, live: true }, { archived: true, live: false }])).toThrow(TRASH_BLOCKED)
    expect(() => checkTrashable([{ archived: true, live: false }])).not.toThrow()
  })
  it('says how many sessions went before one failed, and reports only those as trashed', async () => {
    const { dirs, project, trashExcept } = fixture()
    const pathOf = (sid: string) => join(project, `${sid}.jsonl`)
    const gone: string[] = []
    await expect(trashSessionsTo([{ id }, { id: id2 }], pathOf, trashExcept(pathOf(id2)), (sid) => gone.push(sid), dirs))
      .rejects.toThrow(`Moved 1 of 2 sessions to the Trash. EACCES: ${pathOf(id2)}`)
    expect(gone).toEqual([id])
  })
  it('gives the plain reason when the first session fails', async () => {
    const { dirs, transcript, trashExcept } = fixture()
    const gone: string[] = []
    await expect(trashSessionsTo([{ id }], () => transcript, trashExcept(transcript), (sid) => gone.push(sid), dirs)).rejects.toThrow(/^EACCES/)
    await expect(trashSessionsTo([{ id: id2 }], () => undefined, trashExcept(), (sid) => gone.push(sid), dirs)).rejects.toThrow('Unknown session')
    expect(gone).toEqual([])
  })
  it('names the leftover files after trashing the whole batch', async () => {
    const { dirs, transcript, trashExcept } = fixture()
    const stuck = join(dirs.debug, `${id}.txt`)
    const gone: string[] = []
    await expect(trashSessionsTo([{ id }], () => transcript, trashExcept(stuck), (sid) => gone.push(sid), dirs))
      .rejects.toThrow(`Moved 1 session to the Trash, but couldn't trash: ${stuck}`)
    expect(gone).toEqual([id])
  })
}
