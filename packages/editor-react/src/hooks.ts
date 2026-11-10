// Following an editor view from React.

import type { EditorView } from "@typstream/editor-core";
import { useEffect, useState } from "react";

/**
 * Re-renders after the view changes (state, layout, focus), at most once a frame: a key changes the
 * state and then the layout, and the toolbars only need the last of them. React renders the update
 * after the frame, so typing never waits for the chrome.
 */
export const useViewFrame = (view: EditorView | null): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!view) return;
    let frame = 0;
    const off = view.subscribe(() => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [view]);
  return version;
};
