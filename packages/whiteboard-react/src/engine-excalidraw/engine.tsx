import { Excalidraw, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  WhiteboardEngine,
  WhiteboardHistoryState,
  WhiteboardSession,
} from "@zvonok/whiteboard-core/engine";
import { createRoot } from "react-dom/client";

import type { ExcalidrawElementLike, WhiteboardSceneApi } from "../binding/excalidraw-yjs-binding";
import { ExcalidrawYjsBinding } from "../binding/excalidraw-yjs-binding";

import "@excalidraw/excalidraw/index.css";
import "./engine-overrides.css";

interface SurfaceProps {
  binding: ExcalidrawYjsBinding;
  readonly: boolean;
}

/**
 * The Excalidraw canvas wired to the binding: scene changes flow into the
 * room Yjs document, remote document changes flow back through updateScene.
 */
function ExcalidrawSurface({ binding, readonly }: SurfaceProps) {
  return (
    <Excalidraw
      excalidrawAPI={(api: ExcalidrawImperativeAPI) => {
        const scene: WhiteboardSceneApi = {
          updateScene: (next) => api.updateScene(next as Parameters<typeof api.updateScene>[0]),
        };
        binding.attach(scene);
      }}
      onChange={(elements: readonly ExcalidrawElement[]) => {
        binding.handleLocalChange(elements as readonly ExcalidrawElementLike[]);
      }}
      viewModeEnabled={readonly}
    />
  );
}

/**
 * The default whiteboard engine: upstream Excalidraw bound to the room Yjs
 * document. Mounted through the engine adapter; the host only supplies a
 * transport and a container.
 */
export const excalidrawEngine: WhiteboardEngine = {
  id: "excalidraw",
  async mount(container: HTMLElement, options): Promise<WhiteboardSession> {
    const binding = new ExcalidrawYjsBinding(options.transport, {
      restore: (remote, local) =>
        restoreElements(
          remote as readonly ExcalidrawElement[],
          local as readonly ExcalidrawElement[] | undefined,
          { refreshDimensions: false },
        ),
    });

    // Multiplayer undo replaces the built-in per-client history; intercept
    // the shortcut before the canvas sees it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) binding.redo();
      else binding.undo();
    };
    container.addEventListener("keydown", onKeyDown, true);

    let readonly = !options.canDraw;
    const root = createRoot(container);
    const render = (): void => {
      root.render(<ExcalidrawSurface binding={binding} readonly={readonly} />);
    };
    render();

    return {
      setReadonly(next: boolean): void {
        readonly = next;
        render();
      },
      undo: (): void => binding.undo(),
      redo: (): void => binding.redo(),
      historyState: (): WhiteboardHistoryState => binding.historyState(),
      onHistoryChange: (callback) => binding.onHistoryChange(callback),
      dispose(): void {
        container.removeEventListener("keydown", onKeyDown, true);
        root.unmount();
        binding.dispose();
      },
    };
  },
};
