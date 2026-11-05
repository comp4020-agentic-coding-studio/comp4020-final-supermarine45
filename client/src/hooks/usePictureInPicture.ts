import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Classic requestPictureInPicture via canvas -> captureStream() -> <video>,
// not documentPictureInPicture — broader browser support (Chrome, Edge,
// Safari 13.1+, Firefox 71+) and the user's own spec already calls for a
// <canvas>-based widget.
export function isPipSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    "pictureInPictureEnabled" in document &&
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestPictureInPicture" in HTMLVideoElement.prototype
  );
}

interface CanvasWithCaptureStream extends HTMLCanvasElement {
  captureStream(frameRequestRate?: number): MediaStream;
}

export function usePictureInPicture(): {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  toggle: () => void;
} {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function onLeave(): void {
      setIsActive(false);
    }
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => video.removeEventListener("leavepictureinpicture", onLeave);
  }, []);

  const toggle = useCallback(() => {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      return;
    }
    const canvas = canvasRef.current as CanvasWithCaptureStream | null;
    const video = videoRef.current;
    if (!canvas || !video) return;
    // No frameRequestRate argument: a new frame is captured each time the
    // canvas changes, matching the "redraw on the 1s tick, no RAF loop" cadence.
    if (!video.srcObject) video.srcObject = canvas.captureStream();
    video
      .play()
      .then(() => video.requestPictureInPicture())
      .then(() => setIsActive(true))
      .catch(() => {});
  }, []);

  return { canvasRef, videoRef, isActive, toggle };
}
