/**
 * lib/research/analysis/config.ts
 * =================================
 * Settings for the /r/analysis tools. Everything here is
 * TBD – tune with pilot data. None of these are clinical cut-offs: they only
 * decide how data is grouped and when a summary is considered too small to show.
 */

export interface AgeBand {
  key: string;
  minMonths: number; // inclusive
  maxMonths: number; // inclusive
}

/** Age bands for the age comparison and group summary. TBD – tune with pilot data. */
export const AGE_BANDS: readonly AgeBand[] = [
  { key: "18-23", minMonths: 18, maxMonths: 23 },
  { key: "24-35", minMonths: 24, maxMonths: 35 },
  { key: "36-47", minMonths: 36, maxMonths: 47 },
  { key: "48-59", minMonths: 48, maxMonths: 59 },
  { key: "60-72", minMonths: 60, maxMonths: 72 },
];

export const ANALYSIS_CONFIG = {
  /** Below this many sessions in a band, the age comparison shows "not enough data". TBD – tune with pilot data. */
  minNAgeBand: 20,
  /** Below this many sessions in a group, the group summary greys the row out. TBD – tune with pilot data. */
  minNGroup: 5,
  /** Ask for confirmation before downloading more gaze CSVs than this. */
  gazeDownloadConfirm: 300,
  /**
   * AOI visits: a gap between two valid samples longer than this ends a visit, and no single
   * sample is credited with more dwell time than this. TBD – tune with pilot data.
   */
  aoiMaxGapMs: 250,
} as const;
