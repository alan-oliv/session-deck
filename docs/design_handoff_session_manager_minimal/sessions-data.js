window.CSM_DATA = (function () {
  const repos = [
    { id: 'meetnotes', path: '~/code/meetnotes', remote: 'github.com/alan-oliv/meetnotes', branches: ['main', 'live-meeting', 'transcriptions'], project: 'Meetnote' },
    { id: 'audio-sync', path: '~/code/audio-sync', remote: 'github.com/alan-oliv/audio-sync', branches: ['main', 'fix/failed-transcript'], project: 'Meetnote' },
    { id: 'team8', path: '~/code/team8', remote: 'github.com/alan-oliv/team8', branches: ['main', 'perf/render', 'feat/task-progress'], project: 'Team8' },
    { id: 'code', path: '~/code', remote: 'local folder, not a git repository', branches: ['HEAD'], project: 'Others' },
    { id: 'home', path: '~', remote: 'local folder, not a git repository', branches: ['HEAD'], project: 'Others' }
  ];
  const worktrees = [
    { id: 'wt-transcriptions', name: 'transcriptions', repo: 'meetnotes', path: '~/code/meetnotes/.worktrees/transcriptions', branch: 'transcriptions', stale: true, removed: 'Oct 2' }
  ];
  const collections = ['Current Sprint', 'Bugs', 'Experiments', 'Architecture', 'Personal', 'Finished', 'Research'];
  const tagColors = { meetnotes: 'sky', audio: 'teal', transcription: 'cyan', team8: 'emerald', performance: 'amber', tooling: 'violet', writing: 'pink', personal: 'rose', macos: 'zinc', bug: 'red' };
  const chains = [
    { id: 'meetnote-transcription', name: 'Meetnote transcription', repo: 'meetnotes', steps: [{ id: 's12', label: 'Speaker separation' }, { id: 's8', label: 'Transcription pipeline' }, { id: 's2', label: 'Failed transcript fix' }, { id: 's1', label: 'Live meeting mode' }] },
    { id: 'team8-perf', name: 'Team8 responsiveness', repo: 'team8', steps: [{ id: 's6', label: 'Performance pass' }, { id: 's4', label: 'Background task progress' }] }
  ];
  const clusters = [
    { id: 'transcription', name: 'Transcription and audio', desc: 'Recording, speaker separation and transcript failures in Meetnote.', ids: ['s1', 's2', 's3', 's8', 's12'] },
    { id: 'team8', name: 'Team8', desc: 'Rendering performance and background task progress.', ids: ['s6', 's4'] },
    { id: 'tooling', name: 'Claude tooling', desc: 'Plugins, marketplaces and browser connections for Claude itself.', ids: ['s5', 's9'] },
    { id: 'writing', name: 'Writing', desc: 'Long-form writing and fact checking.', ids: ['s7', 's11'] },
    { id: 'mac', name: 'Mac maintenance', desc: 'Disk space and local machine housekeeping.', ids: ['s10', 's9'] }
  ];
  const base = { refCommits: [], artifacts: [], errors: 0, uncommitted: [], running: false, fav: false, collections: [], related: null, tests: null, cwd: '~/code', wt: null, ver: '2.1.4' };
  const S = (o) => Object.assign({}, base, o, { tags: o.tags || [], collections: o.collections || [] });

  const sessions = [
    S({
      id: 's1', sid: 'c3f1a9d2-6b84-4e07-9a15-7d20e8b4f6a1', title: 'live-meeting', auto: false,
      usage: { effort: 'xhigh', ctxUsed: 263e3, ctxMax: 1e6, inTok: 150, outTok: 190.9e3, total: 14.2e6, cacheHit: 99.2, cacheRead: 260.8e3, cacheWrite: 2.2e3, cached: 14.1e6, cost: 5.08, compactions: 0, agents: 3, mode: 'Bypass permissions', style: 'architecture', durMin: 40, plan: { used: 32.9, reset: '4h 7m' }, lines: [0, 0], pr: 30 },
      repo: 'meetnotes', cwd: '~/code/meetnotes', branch: 'live-meeting', branchStart: 'main',
      start: '2026-10-06T09:12', dur: 40, status: 'active', model: 'Claude Opus 5.5', head: '4e9c1b7', size: '6.1MB',
      files: 9, add: 524, del: 131,
      fileList: [{ p: 'src/live/LiveMeetingView.tsx', a: 212, d: 18 }, { p: 'src/audio/streamCapture.ts', a: 141, d: 52 }, { p: 'src/transcribe/partialTranscript.ts', a: 96, d: 30 }, { p: 'src/ipc/channels.ts', a: 22, d: 4 }],
      pr: null, commits: [{ sha: '4e9c1b7', msg: 'Stream partial transcripts to the live view', t: '10:31 AM' }],
      uncommitted: [{ p: 'src/live/LiveMeetingView.tsx', s: 'M' }, { p: 'src/audio/streamCapture.ts', s: 'M' }, { p: 'src/live/SpeakerChips.tsx', s: 'A' }],
      running: true, fav: true, tags: ['meetnotes', 'transcription'], collections: ['Current Sprint'], project: 'Meetnote',
      prompt: 'Add a live meeting mode that shows the transcript while the meeting is still running.',
      concepts: ['live', 'meeting', 'transcript', 'streaming', 'audio', 'speaker', 'meetnote'],
      summary: { goal: 'Show a running transcript during the meeting instead of only after it ends.', did: 'Added chunked audio capture, streamed partial transcripts over IPC and built a live view. Speaker chips are in progress.', decisions: ['Partial transcripts are replaced, not appended, when a chunk is finalized.'], state: 'Running in the meetnotes tab with three uncommitted files.', next: ['Finish speaker chips', 'Open PR against main'] },
      tokens: { in: '512k', out: '88k', cache: '4.1M' }
    }),
    S({
      id: 's2', sid: '8b2e07c4-1f93-4a6d-b5e0-3c9d41a7e2f8', title: 'meetnotes-failed-to-transcript', auto: false,
      repo: 'audio-sync', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T18:40', dur: 41, status: 'completed', model: 'Claude Opus 4.5', head: 'a17d3e0', size: '1.7MB',
      files: 3, add: 64, del: 19,
      fileList: [{ p: 'audio-sync/src/resample.ts', a: 38, d: 12 }, { p: 'audio-sync/src/chunker.ts', a: 20, d: 7 }, { p: 'audio-sync/test/resample.test.ts', a: 6, d: 0 }],
      pr: { n: 3, title: 'Fix failed transcripts on long recordings', state: 'open', base: 'main', repoFull: 'alan-oliv/audio-sync' },
      commits: [{ sha: 'a17d3e0', msg: 'Resample before chunking long recordings', t: '7:12 PM' }],
      tests: 'passed', tags: ['meetnotes', 'audio', 'bug'], collections: ['Bugs'], project: 'Meetnote',
      prompt: 'Meetnotes failed to transcript my last meeting. Find out why.',
      concepts: ['transcript', 'failed', 'audio', 'resample', 'chunk', 'meeting', 'meetnote', 'bug'],
      summary: { goal: 'Find out why a long meeting failed to transcribe.', did: 'Traced the failure to audio chunks with the wrong sample rate and resampled before chunking in audio-sync.', decisions: ['Fix lives in audio-sync, not in the Meetnote app.'], state: 'PR alan-oliv/audio-sync#3 is open.', next: ['Merge #3 and bump audio-sync in meetnotes'] },
      tokens: { in: '140k', out: '21k', cache: '980k' }
    }),
    S({
      id: 's3', sid: 'f40c9e18-7a2d-4b5c-8e61-0d93b7a2c5e4', title: 'meetnotes-improvements', auto: false,
      repo: 'meetnotes', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T14:05', dur: 212, status: 'paused', model: 'Claude Opus 4.5', head: '9c0b2f5', size: '13.9MB',
      files: 21, add: 1180, del: 402,
      fileList: [{ p: 'meetnotes/src/notes/NoteEditor.tsx', a: 260, d: 98 }, { p: 'meetnotes/src/notes/summarize.ts', a: 174, d: 61 }, { p: 'meetnotes/src/settings/Appearance.tsx', a: 148, d: 12 }, { p: 'meetnotes/src/window/vibrancy.ts', a: 66, d: 9 }],
      pr: { n: 27, title: 'Meetnotes improvements', state: 'open', base: 'main', repoFull: 'alan-oliv/meetnotes' },
      commits: [{ sha: '2d8a61c', msg: 'Window opacity and blur settings', t: '3:20 PM' }, { sha: '7f1e0a9', msg: 'Faster note summaries', t: '4:48 PM' }, { sha: '9c0b2f5', msg: 'Editor keyboard shortcuts', t: '5:31 PM' }],
      tags: ['meetnotes'], collections: ['Current Sprint'], project: 'Meetnote',
      prompt: 'A batch of improvements for meetnotes: appearance settings, faster summaries and editor shortcuts.',
      concepts: ['meetnote', 'improvement', 'settings', 'opacity', 'blur', 'accent', 'summary', 'editor'],
      summary: { goal: 'Ship a batch of quality-of-life improvements to Meetnote.', did: 'Added window opacity, blur and accent settings, sped up summaries and added editor shortcuts.', decisions: ['Appearance settings apply live and persist per machine.'], state: 'Paused. PR alan-oliv/meetnotes#27 is open.', next: ['Respond to review on #27'] },
      tokens: { in: '1.1M', out: '190k', cache: '9.8M' }
    }),
    S({
      id: 's4', sid: '2a6d5f31-c08e-4b97-a3d4-e15f86b0c927', title: 'In progress tasks background progress reflection', auto: true,
      repo: 'team8', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T11:20', dur: 64, status: 'completed', model: 'Claude Sonnet 4.5', head: 'b81c4e2', size: '3.4MB',
      files: 6, add: 238, del: 77,
      fileList: [{ p: 'team8/src/tasks/TaskRow.tsx', a: 82, d: 30 }, { p: 'team8/src/tasks/useTaskProgress.ts', a: 104, d: 21 }, { p: 'team8/src/workers/progress.ts', a: 40, d: 18 }],
      pr: { n: 38, title: 'Reflect background progress on in-progress tasks', state: 'open', base: 'main', repoFull: 'alan-oliv/team8' },
      commits: [{ sha: '5e03d7a', msg: 'Emit progress events from background workers', t: '11:58 AM' }, { sha: 'b81c4e2', msg: 'Show progress on in-progress task rows', t: '12:19 PM' }],
      tests: 'passed', tags: ['team8'], project: 'Team8',
      prompt: 'In-progress tasks should reflect the progress of the background job that is running them.',
      concepts: ['task', 'progress', 'background', 'worker', 'team8', 'status'],
      summary: { goal: 'Show live progress on tasks whose work runs in the background.', did: 'Emitted progress events from workers and subscribed task rows to them.', decisions: ['Progress is throttled to one update per 250 ms.'], state: 'PR alan-oliv/team8#38 is open.', next: [] },
      tokens: { in: '260k', out: '44k', cache: '1.7M' }
    }),
    S({
      id: 's5', sid: '6e9b13d0-4c2a-4f78-91e5-ab07c3d8f412', title: 'Claude command to update all marketplaces', auto: true,
      repo: 'code', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T10:02', dur: 14, status: 'completed', model: 'Claude Sonnet 4.5', head: '—', size: '289.8KB',
      files: 1, add: 34, del: 0, fileList: [{ p: '.claude/commands/update-marketplaces.md', a: 34, d: 0 }],
      pr: null, commits: [],
      artifacts: [{ name: 'update-marketplaces.md', kind: 'markdown', size: '1 KB', path: '.claude/commands/update-marketplaces.md', preview: '---\ndescription: Update every installed plugin marketplace\n---\n\nFor each marketplace in ~/.claude/plugins, pull the latest version and report what changed.' }],
      tags: ['tooling'], project: 'Others',
      prompt: 'Make a Claude command that updates all my plugin marketplaces at once.',
      concepts: ['claude', 'command', 'marketplace', 'plugin', 'update', 'tooling'],
      summary: { goal: 'Update every installed plugin marketplace with one command.', did: 'Wrote a slash command that walks installed marketplaces and pulls each one.', decisions: [], state: 'Command saved in ~/code/.claude/commands.', next: [] },
      tokens: { in: '22k', out: '4k', cache: '60k' }
    }),
    S({
      id: 's6', sid: 'd17a4c86-90b3-4e2f-b6c1-58e2f0a9d3b7', title: 'team8-performance', auto: false,
      repo: 'team8', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T08:30', dur: 168, status: 'completed', model: 'Claude Opus 4.5', head: '3c7f9a1', size: '18.6MB',
      files: 14, add: 612, del: 389,
      fileList: [{ p: 'team8/src/board/Board.tsx', a: 140, d: 120 }, { p: 'team8/src/board/useVirtualRows.ts', a: 118, d: 0 }, { p: 'team8/src/store/selectors.ts', a: 96, d: 74 }, { p: 'team8/src/board/Card.tsx', a: 44, d: 61 }],
      pr: { n: 36, title: 'Team8 performance', state: 'open', base: 'main', repoFull: 'alan-oliv/team8' },
      commits: [{ sha: '0b4e2d8', msg: 'Memoize board selectors', t: '9:40 AM' }, { sha: '81a6f3c', msg: 'Virtualize board rows', t: '10:22 AM' }, { sha: '3c7f9a1', msg: 'Drop re-renders on card hover', t: '11:05 AM' }],
      artifacts: [{ name: 'profile-before-after.json', kind: 'json', size: '48 KB', path: '.claude/artifacts/profile-before-after.json', preview: '{\n  "board_render_ms": { "before": 182, "after": 31 },\n  "cards": 1200\n}' }],
      tests: 'passed', fav: true, tags: ['team8', 'performance'], project: 'Team8',
      prompt: 'team8 board is slow with a lot of cards. Profile it and fix the worst offenders.',
      concepts: ['performance', 'render', 'board', 'virtualize', 'memoize', 'profile', 'team8'],
      summary: { goal: 'Make the Team8 board fast with large task counts.', did: 'Profiled the board, memoized selectors, virtualized rows and removed hover re-renders.', decisions: ['Virtualize rows rather than paginate the board.'], state: 'PR alan-oliv/team8#36 is open.', next: [] },
      tokens: { in: '1.4M', out: '160k', cache: '12M' }
    }),
    S({
      id: 's7', sid: '93c5e2a7-b14f-4d08-8a6e-2f71d0c4b9e3', title: 'blog-post-veracity', auto: false,
      repo: 'code', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-03T07:10', dur: 96, status: 'completed', model: 'Claude Opus 4.5', head: '—', size: '12.7MB',
      files: 1, add: 0, del: 0, fileList: [],
      pr: null, commits: [],
      artifacts: [{ name: 'veracity-report.md', kind: 'markdown', size: '9 KB', path: '.claude/artifacts/veracity-report.md', preview: '# Veracity report\n\nEach claim in the draft is listed with a source, or marked as unsupported.' }],
      forks: 1, tags: ['writing'], collections: ['Research'], project: 'Others',
      prompt: 'Check the claims in this blog post draft and tell me which ones are not supported.',
      concepts: ['blog', 'post', 'veracity', 'fact', 'claims', 'sources', 'writing', 'research'],
      summary: { goal: 'Fact-check a blog post draft.', did: 'Went through the claims and produced a report with a source or an unsupported flag for each.', decisions: [], state: 'Report written. The session was forked once.', next: [] },
      tokens: { in: '880k', out: '70k', cache: '5.2M' }
    }),
    S({
      id: 's8', sid: '5f08b3e1-2d7c-4a96-b4f0-c69e1a8d27b5', title: 'transcriptions', auto: false,
      repo: 'meetnotes', wt: 'wt-transcriptions', cwd: null, branch: 'transcriptions', branchStart: 'main',
      start: '2026-10-01T15:30', dur: 184, status: 'completed', model: 'Claude Opus 4.5', head: 'e2a90c4', size: '12.3MB',
      files: 12, add: 702, del: 155,
      fileList: [{ p: 'src/transcribe/pipeline.ts', a: 230, d: 40 }, { p: 'src/transcribe/whisperClient.ts', a: 160, d: 22 }, { p: 'src/transcribe/queue.ts', a: 118, d: 0 }],
      pr: { n: 25, title: 'Transcriptions', state: 'open', base: 'main', repoFull: 'alan-oliv/meetnotes' },
      commits: [{ sha: '71bd0e3', msg: 'Transcription queue', t: '4:42 PM' }, { sha: 'e2a90c4', msg: 'Retry failed transcription chunks', t: '6:10 PM' }],
      tests: 'passed', tags: ['meetnotes', 'transcription'], project: 'Meetnote',
      prompt: 'Build the transcription pipeline for recorded meetings.',
      concepts: ['transcription', 'transcript', 'pipeline', 'queue', 'whisper', 'meeting', 'meetnote'],
      summary: { goal: 'Transcribe recorded meetings in the background.', did: 'Built a queue-backed pipeline with chunk retries.', decisions: ['Transcription runs in a worker queue, one recording at a time.'], state: 'PR alan-oliv/meetnotes#25 is open. The worktree has since been removed.', next: [] },
      tokens: { in: '940k', out: '150k', cache: '7.3M' }
    }),
    S({
      id: 's9', sid: 'a4d7e290-63b1-4f5c-9e28-b0c51f3a8d64', title: 'Disconnect Claude Chrome', auto: true,
      repo: 'code', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-01T12:15', dur: 9, status: 'completed', model: 'Claude Sonnet 4.5', head: '—', size: '330.3KB',
      files: 0, add: 0, del: 0, fileList: [], pr: null, commits: [],
      tags: ['tooling'], project: 'Others',
      prompt: 'How do I disconnect Claude from Chrome?',
      concepts: ['claude', 'chrome', 'browser', 'extension', 'disconnect', 'tooling'],
      summary: { goal: 'Disconnect the Claude browser connection from Chrome.', did: 'Walked through removing the connection and confirmed it was gone.', decisions: [], state: 'Done.', next: [] },
      tokens: { in: '18k', out: '3k', cache: '40k' }
    }),
    S({
      id: 's10', sid: '0c8e5b72-a91d-4e36-87f4-d23b6a0e19c5', title: 'Mac storage cleanup', auto: true,
      repo: 'home', cwd: '~/code', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-10-01T09:40', dur: 22, status: 'completed', model: 'Claude Sonnet 4.5', head: '—', size: '480.3KB',
      files: 0, add: 0, del: 0, fileList: [], pr: null, commits: [],
      artifacts: [{ name: 'disk-usage.txt', kind: 'report', size: '4 KB', path: '.claude/artifacts/disk-usage.txt', preview: '42G  ~/Library/Developer/Xcode/DerivedData\n18G  ~/code/**/node_modules\n9.1G ~/Library/Caches' }],
      tags: ['macos', 'personal'], collections: ['Personal'], project: 'Others',
      prompt: 'My Mac is almost out of storage. Find what is taking space and what is safe to delete.',
      concepts: ['mac', 'storage', 'disk', 'cleanup', 'cache', 'node_modules'],
      summary: { goal: 'Free disk space on the Mac.', did: 'Listed the largest folders and cleared caches that are safe to rebuild.', decisions: ['Keep Xcode simulators; clear DerivedData.'], state: 'Done.', next: [] },
      tokens: { in: '30k', out: '6k', cache: '80k' }
    }),
    S({
      id: 's11', sid: 'e61f0a3c-5b28-4d97-a0c3-7e94b2d1f856', title: 'Personalidade espelho', auto: true,
      repo: 'code', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-09-30T21:05', dur: 18, status: 'completed', model: 'Claude Opus 4.5', head: '—', size: '297.9KB',
      files: 0, add: 0, del: 0, fileList: [], pr: null, commits: [],
      tags: ['personal', 'writing'], collections: ['Personal'], project: 'Others',
      prompt: 'Personalidade espelho',
      concepts: ['personalidade', 'espelho', 'personal', 'writing'],
      summary: { goal: 'A personal conversation, in Portuguese.', did: 'Conversation only; no files changed.', decisions: [], state: 'Done.', next: [] },
      tokens: { in: '20k', out: '7k', cache: '30k' }
    }),
    S({
      id: 's12', sid: '7b3c92e5-08f4-4a1d-9c67-41e0d8b5a2f3', title: 'Differentiate speakers in meeting', auto: true,
      repo: 'meetnotes', branch: 'HEAD', branchStart: 'HEAD',
      start: '2026-09-30T16:20', dur: 33, status: 'interrupted', model: 'Claude Opus 4.5', head: 'd04f6b2', size: '484KB',
      files: 2, add: 48, del: 6,
      fileList: [{ p: 'meetnotes/src/transcribe/diarize.ts', a: 44, d: 4 }, { p: 'meetnotes/src/transcribe/types.ts', a: 4, d: 2 }],
      pr: null, commits: [],
      uncommitted: [{ p: 'meetnotes/src/transcribe/diarize.ts', s: 'A' }, { p: 'meetnotes/src/transcribe/types.ts', s: 'M' }],
      tags: ['meetnotes', 'transcription'], collections: ['Experiments'], project: 'Meetnote',
      prompt: 'Can we tell the speakers apart in a meeting transcript?',
      concepts: ['speaker', 'diarization', 'differentiate', 'meeting', 'transcript', 'meetnote'],
      summary: { goal: 'Label who is speaking in meeting transcripts.', did: 'Sketched a diarization step and a speaker field on transcript segments.', decisions: ['Try on-device diarization before a hosted API.'], state: 'Interrupted with two uncommitted files.', next: ['Pick a diarization model', 'Wire speakers into the transcript view'] },
      tokens: { in: '60k', out: '11k', cache: '210k' }
    })
  ];
  return { now: '2026-10-06T11:00', repos, worktrees, collections, tagColors, chains, clusters, sessions };
})();
