// Whose voice is in each reciter's basmala and isti'adha sources, and which chapter files cannot be windowed
// (research/00-gaps.md §2.6, §2.8, §6.3; decision D7). Hand-maintained from two committed research files, and
// checked against both by reciters.test.ts:
// - research/fixtures/gaps/everyayah-istiadha-basmala-identity.txt — decoded-PCM hashes: the audhubillah.mp3 of
//   Shuraim, Ghamdi and Ayyoub is Alafasy's recording, Shuraim and Ayyoub share one bismillah.mp3, Tunaiji's
//   001001.mp3 is Minshawi's, Ali Jaber's 001001.mp3 is isti'adha + basmala;
// - research/fixtures/gaps/everyayah-istiadha-basmala.jsonl — which EveryAyah folders have the files at all.
// One row per catalogue reciter: a reciter added to the catalogue without a row fails the test.

export interface ReciterVoice {
  /**
   * Where the basmala clip (ayah 0) comes from.
   * 'ayah-1:1' — the reciter's own 1:1 through the class source: A its 001001.mp3 cut by the 1:1 segments,
   *   B the QDC chapter-1 1:1 window, C its 001001.mp3, D the mp3quran read's 1:1 window.
   * 'bismillah.mp3' — EveryAyah's bismillah.mp3 in the reciter's folder (Ali Jaber: his 001001.mp3 holds the
   *   isti'adha AND the basmala), which is then also his recitation of 1:1 (reciters.everyAyahUrl).
   */
  basmala: 'ayah-1:1' | 'bismillah.mp3'
  /**
   * EveryAyah audhubillah.mp3: 'own' = his own recording (offered); 'foreign' = the folder's file is another
   * reciter's recording (not offered, D7); 'none' = no file.
   */
  istiadha: 'own' | 'foreign' | 'none'
  /** the EveryAyah 001001.mp3 is another reciter's recording (Tunaiji: Minshawi's) — never play it */
  foreign001001: boolean
  /** chapters whose class-B file is Xing VBR: never windowed, served from the per-ayah files instead (§2.6, §2.7) */
  vbrChapters: readonly number[]
}

const row = (o: Partial<ReciterVoice> = {}): ReciterVoice => ({ basmala: 'ayah-1:1', istiadha: 'none', foreign001001: false, vbrChapters: [], ...o })

/** §6.3, all 28 catalogue reciters. */
export const RECITER_VOICE: Readonly<Record<string, ReciterVoice>> = {
  // class A
  alafasy: row({ istiadha: 'own' }), // audhubillah.mp3 6.75 s
  'abdulbasit-murattal': row(),
  husary: row({ istiadha: 'own' }), // 5.28 s
  'minshawi-murattal': row(),
  sudais: row(),
  shuraim: row({ istiadha: 'foreign' }), // Alafasy's audhubillah.mp3; the shared bismillah.mp3 is never used
  shatri: row({ istiadha: 'own' }), // 7.90 s
  'hani-rifai': row(), // bismillah.mp3 exists; 001001.mp3 keeps every class-A reciter uniform
  'abdulbasit-mujawwad': row(),
  'minshawi-mujawwad': row(),
  'husary-muallim': row(),
  tablawi: row(),
  // class B
  'yasser-dosari': row(), // QDC 97 ch 1; the preamble's content is open (U12)
  'khalifa-tunaiji': row({ foreign001001: true, vbrChapters: [14, 72] }), // QDC 161 ch 1, never EveryAyah 001001.mp3
  'khalid-jalil': row(), // QDC 170 ch 1, no EveryAyah folder
  // class C
  'maher-muaiqly': row(),
  'ahmed-ajmi': row(),
  'nasser-qatami': row(),
  'husary-mujawwad': row(), // 3.9 s of leading silence in 001001.mp3: the planner trims silence of per-ayah files
  'muhammad-ayyub': row({ istiadha: 'foreign' }), // Alafasy's audhubillah.mp3; the shared bismillah.mp3 is never used
  'muhammad-jibreel': row(),
  'fares-abbad': row(),
  'abdullah-basfar': row(),
  'ali-jaber': row({ basmala: 'bismillah.mp3', istiadha: 'own' }), // own bismillah.mp3 (6.45 s) and audhubillah.mp3 (U13)
  'salah-budair': row(),
  hudhaifi: row({ istiadha: 'own' }), // 6.96 s (U13)
  // class D
  'saad-ghamdi': row({ istiadha: 'foreign' }), // the mp3quran 1:1, EveryAyah 001001.mp3 as the fallback
  'idrees-abkar': row(), // the mp3quran 1:1, no EveryAyah folder
}

const NONE = row()

/** The row of a reciter (a reciter without one gets no isti'adha, the class-source basmala and no VBR chapters). */
export function voiceOf(reciterId: string): ReciterVoice {
  return Object.hasOwn(RECITER_VOICE, reciterId) ? RECITER_VOICE[reciterId] : NONE
}
