"use client";

/**
 * Webcam + the same mirrored 640×480 capture canvas the test runner uses, so calibration,
 * checks and tests all feed MediaPipe identical images.
 */

import { useCallback, useEffect, useRef } from "react";
import { CAPTURE_H, CAPTURE_W } from "@/hooks/useGazeTestRunner";

export function useMirroredCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    streamRef.current = await navigator.mediaDevices.getUserMedia({
      video: { width: CAPTURE_W, height: CAPTURE_H },
      audio: false,
    });
    if (videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      await videoRef.current.play();
    }
  }, []);

  const grab = useCallback((): HTMLCanvasElement | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Identical mirroring to hooks/useGazeTestRunner.ts.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    return canvas;
  }, []);

  return { videoRef, canvasRef, start, stop, grab };
}
