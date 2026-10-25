"use client";

/**
 * Full-screen stage used by calibration and by the end-of-session check:
 * shows the target, a status chip, and an operator bar (re-attract, skip, pause, sound).
 * Keyboard: Space = re-attract, S = skip point, P = pause/resume, Esc = stop.
 */

import { useEffect } from "react";
import rs from "@/styles/research.module.css";
import AttentionTarget, { type TargetPhase } from "./AttentionTarget";
import type { SoundPrefs } from "@/lib/research/attentionSound";

export interface StageTarget {
  x: number;
  y: number;
  index: number;
  phase: TargetPhase;
  progress: number;
}

export default function CalibrationStage({
  target,
  childMode,
  status,
  warning,
  onReattract,
  onSkip,
  paused,
  onTogglePause,
  sound,
  onSoundChange,
  onStop,
}: {
  target: StageTarget | null;
  childMode: boolean;
  status: string;
  warning: string | null;
  onReattract: () => void;
  onSkip: () => void;
  paused: boolean;
  onTogglePause: () => void;
  sound: SoundPrefs;
  onSoundChange: (p: SoundPrefs) => void;
  onStop: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        onReattract();
      } else if (e.key === "s" || e.key === "S") {
        onSkip();
      } else if (e.key === "p" || e.key === "P") {
        onTogglePause();
      } else if (e.key === "Escape") {
        onStop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReattract, onSkip, onTogglePause, onStop]);

  return (
    <div className={rs.overlay}>
      <div className={`${rs.overlayStatus} ${warning ? rs.overlayWarning : ""}`}>{warning ?? status}</div>
      {target && !paused && (
        <AttentionTarget
          x={target.x}
          y={target.y}
          index={target.index}
          phase={target.phase}
          childMode={childMode}
          progress={target.progress}
        />
      )}
      {paused && (
        <div className={rs.overlayStatus} style={{ top: "45%" }}>
          หยุดชั่วคราว / Paused — กด P เพื่อทำต่อ / press P to continue
        </div>
      )}
      <div className={rs.operatorBar}>
        <button onClick={onReattract} title="Space">
          ✨ เรียกความสนใจ / Attract (Space)
        </button>
        <button onClick={onSkip} title="S">
          ข้ามจุด / Skip (S)
        </button>
        <button onClick={onTogglePause} title="P">
          {paused ? "▶ ทำต่อ / Resume" : "⏸ หยุด / Pause"} (P)
        </button>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={sound.on} onChange={(e) => onSoundChange({ ...sound, on: e.target.checked })} />
          🔈
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            onChange={(e) => onSoundChange({ ...sound, volume: Number(e.target.value) })}
            aria-label="Volume"
            style={{ width: 80 }}
          />
        </label>
        <button onClick={onStop} title="Esc">
          ✕ (Esc)
        </button>
      </div>
    </div>
  );
}
