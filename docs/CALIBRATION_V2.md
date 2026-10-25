# Calibration v2: more accurate, child-friendly

Written Oct 25, 2026. Code: `components/research/CalibrationClient.tsx`, `useGazeStage.ts`, `CalibrationStage.tsx`,
`AttentionTarget.tsx`, `EndCheck.tsx`; `lib/research/gaze/calibrationCore.ts`, `collector.ts`;
`lib/research/attentionSound.ts`; settings in `lib/research/config.ts`.

## Why v1 needed several tries

1. **Samples were taken on a timer.** v1 waited 0.7 s, then recorded 1.2 s, whether or not the eyes had reached
   the dot. Search movements (saccades) and blinks went into the fit. In a simulation (`tests/calibration.test.ts`)
   this alone made the error about 4–5× worse: about 18 px vs 4 px. That figure is idealised; real webcam noise is
   larger.
2. **Head turns and eye turns were mixed together.** v1 had only rough head proxies from landmarks.
3. **One bad point meant starting over.**
4. **The pass threshold was a fixed 150 px**, regardless of screen size.

## What changed

| Change | Why | Source |
| --- | --- | --- |
| **Gaze-contingent collection.** Samples are kept only while the eyes are still (fixating). The point finishes when enough are collected | Infant protocols advance only after the child has looked at the target for a set time | Dalrymple et al., 2018 |
| **Automatic re-attract.** If the child stops looking, the target wiggles and plays a sound; the operator can also press Space | Use attention-getters when the child looks away | Dalrymple et al., 2018; Muratori et al., 2019 |
| **Child mode (default under 6 years): 5 points**; adult mode: 9 points | Toddlers are calibrated with 5-point infant procedures, adults with 9 | Dalrymple et al., 2018; Muratori et al., 2019 |
| **Animated animals that loom (shrink) onto each point, with a gentle chime**, plus a small reward after each point | Animal graphics shrinking into each point with a sound; dynamic targets with sound; cartoon targets | Bánki et al., 2022; Dalrymple et al., 2018; Muratori et al., 2019 |
| **Skipped points are retried once**; "Improve weak spots" redoes only the points near the worst errors | Let caregivers skip individual items; more completed points improve data | Bánki et al., 2022; *Behavior Research Methods* (human and macaque infants) |
| **Outliers removed per point** (median ± 3 MAD) | Robust fitting | — |
| **Real head pose** (yaw and pitch from MediaPipe's transformation matrix) added to the model | Separates head movement from eye movement | — |
| **Error reported in approximate degrees and graded**: high < 2.5°, medium < 3.75°, low < 5°, fail ≥ 5°. Pass = ≤ 5° (TBD) | The same grading used for infant webcam calibration | Bánki et al., 2022 |
| **Final 10-second check after Test 3.** It measures accuracy again; a large drift flags the session for retest. It doesn't "correct" the data | Verify accuracy before and after the task; prefer discarding unreliable data over offset correction | Dalrymple et al., 2018 |
| **Operator controls**: re-attract, skip, pause, sound on/off and volume | Data quality depends on the operator | Hessels & Hooge, 2019 |
| **Instructions**: seat the child on a lap or chair about an arm's length away, light on the face, no distractions, don't point | Parents adjust distance and light so the eyes are visible; minimise distraction | Kandel & Snedeker, 2025 |

### Considerations for autistic children

- **Sound sensitivity**: soft-onset pentatonic tones, low default volume, and one-click mute or volume adjustment.
  The setting is remembered per device.
- **Motion sensitivity**: animations respect the operating system's "reduce motion" setting.
- **Non-social targets** (animals, a ball, a star) rather than faces, so calibration doesn't depend on social
  attention. That is the very thing being screened.
- **Pause at any time (P)**, with no penalty: paused time doesn't count towards giving up on a point.
- Varied targets in a shuffled order (centre first), to reduce habituation.

## Calibration v3 (why v2 still failed for children)

v2 fitted a 13-term model (eye terms, their squares and products, and every head term) from only 5 child
targets. With so few target positions the model "explained" them using whatever the child's head happened to be
doing at each one, then missed new positions badly; the 3 check dots showed that, so it kept saying "retry".
In a simulation of a restless child (head wanders and partly turns toward targets, noisy iris landmarks) v2's
true error was about 370 px (≈ 9°) and it passed 8% of the time.

v3 changes:
- **Compact model**: horizontal gaze from eye-x, head yaw and face position x; vertical from eye-y, head pitch
  and face position y (4 numbers per axis instead of 13). Same features, far less overfitting.
- **Child mode: 8 targets, no separate check dots.** The 3 former check positions become calibration targets
  (same number of animals for the child), and accuracy is measured by *leave-one-point-out* on the 4 inner
  targets: fit without that target, see how far the prediction lands from it. In simulation this estimate is
  within a few percent of the true error.
- Simulated restless child: true error ≈ 95 px (≈ 2.4°), passes ~100% (v2: 370 px, 8%). Adults keep 9 targets
  plus 4 check dots, now with the compact model.
- **Download calibration data** (result screen): the raw numbers (no images, no child code) so the settings
  can be tuned on real children.

The simulation is a model of reality, not a real child; pilot data should confirm it.

## Settings to tune with pilot data (`lib/research/config.ts`)

`maxCalibrationErrorDeg` (5), `maxEndCheckErrorDeg` (6), `childModeUnderMonths` (72), `fixationMaxSpread`,
`fixationWindow`, and per-mode samples, re-attract and give-up times. The degree values assume a 60 cm viewing
distance and nominal 96 CSS px per inch. They are approximate and must not be reported as exact visual angles.

## What still limits accuracy

Webcam eye tracking is far less precise than lab trackers. In child studies, webcam error averaged about 38% of
screen size, with vertical errors larger than horizontal (Kandel & Snedeker, 2025). LookAtMe's tests already favour
this: Test 1 compares left and right halves, and Tests 2–3 use large video areas. Keep new stimuli on different
halves of the screen, and avoid small or vertical-only areas of interest.

## Sources

- Bánki, A., de Eccher, M., Falschlehner, L., Hoehl, S., & Markova, G. (2022). Comparing online webcam- and laboratory-based eye-tracking for the assessment of infants' audio-visual synchrony perception. *Frontiers in Psychology*, 12, 733933. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2021.733933/pdf
- Dalrymple, K. A., Manner, M. D., Harmelink, K. A., Teska, E. P., & Elison, J. T. (2018). An examination of recording accuracy and precision from eye tracking data from toddlerhood to adulthood. *Frontiers in Psychology*, 9, 803. https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00803/pdf
- Muratori, F., et al. (2019). How attention to faces and objects changes over time in toddlers with autism spectrum disorders: preliminary evidence from an eye tracking study. *Brain Sciences*, 9(12), 344. https://pmc.ncbi.nlm.nih.gov/articles/PMC6955945
- Hessels, R. S., & Hooge, I. T. C. (2019). Eye tracking in developmental cognitive neuroscience – The good, the bad and the ugly. *Developmental Cognitive Neuroscience*, 40. https://doaj.org/article/6fbcce8a3c8a4c18be450279852dfec6
- Kandel, M., & Snedeker, J. (2025). Assessing two methods of webcam-based eye-tracking for child language research. *Journal of Child Language*, 52, 675–708. https://www.cambridge.org/core/services/aop-cambridge-core/content/view/F28BD05F1D529D3ADE04F2E28A5EE4CB/S0305000924000175a.pdf/assessing-two-methods-of-webcam-based-eye-tracking-for-child-language-research.pdf
- Steffan, A., et al. (2024). Validation of an open source, remote web-based eye-tracking method (WebGazer) for research in early childhood. *Infancy*, 29(1), 31–55. https://cris.haifa.ac.il/en/publications/validation-of-an-open-source-remote-web-based-eye-tracking-method/
- Maximizing valid eye-tracking data in human and macaque infants by optimizing calibration and adjusting areas of interest. *Behavior Research Methods*. https://par.nsf.gov/biblio/10400694-maximizing-valid-eye-tracking-data-human-macaque-infants-optimizing-calibration-adjusting-areas-interest
- Sasson, N. J., Elison, J. T., et al. (2011). Brief report: Circumscribed attention in young children with autism. *Journal of Autism and Developmental Disorders*, 41(2), 242–247. https://pmc.ncbi.nlm.nih.gov/articles/PMC3709851
