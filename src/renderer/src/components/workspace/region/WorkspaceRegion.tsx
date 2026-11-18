import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
} from "react";
import type {
  Layout,
  PaneNode,
  SplitNode,
  SplitPath,
} from "../layout/layout";
import { paneTypes, type PaneType } from "../layout/pane-types";
import type { Region } from "../layout/regions";
import Pane, { type PaneProps } from "./pane/Pane";
import PaneSplit from "./split/PaneSplit";

export type RegionPaneProps = Omit<PaneProps, "pane" | "hasRegionHandle">;

interface WorkspaceRegionProps {
  region: Region;
  floating?: CSSProperties;
  separating: boolean;
  groupSurfaceRef: Ref<HTMLDivElement>;
  onDragStart: PointerEventHandler<HTMLButtonElement>;
  onMoveKeyDown: KeyboardEventHandler<HTMLButtonElement>;
  getPaneProps: (pane: PaneNode) => RegionPaneProps;
  getDividerProps: (
    path: SplitPath,
    axis: SplitNode["axis"],
  ) => HTMLAttributes<HTMLDivElement>;
  renderEmptyRegion: (type: PaneType) => ReactNode;
}

export default function WorkspaceRegion({
  region,
  floating,
  separating,
  groupSurfaceRef,
  onDragStart,
  onMoveKeyDown,
  getPaneProps,
  getDividerProps,
  renderEmptyRegion,
}: WorkspaceRegionProps) {
  const label = paneTypes[region.type].label;
  const frameClass = separating ? " is-separating" : " is-framed";

  function renderLayout(node: Layout, path: SplitPath = []): ReactNode {
    if (node.kind === "pane") {
      return (
        <Pane
          key={node.id}
          pane={node}
          hasRegionHandle={path.every((branch) => branch === "first")}
          {...getPaneProps(node)}
        />
      );
    } else if (node.kind === "split") {
      return (
        <PaneSplit
          split={node}
          separating={separating}
          first={renderLayout(node.first, [...path, "first"])}
          second={renderLayout(node.second, [...path, "second"])}
          dividerProps={getDividerProps(path, node.axis)}
        />
      );
    }
  }

  return (
    <div className={`region-slot${floating ? " region-slot-dragging" : ""}`}>
      <section
        className={`workspace-region${floating ? " region-floating" : ""}`}
        aria-label={`${label} region`}
        data-region={region.type}
        style={
          { ...floating, "--vt": `region-${region.type}` } as CSSProperties
        }
      >
        <button
          type="button"
          className="region-drag-handle quiet-button"
          aria-label={`Move ${label} region`}
          title="Drag to swap sides, or use the Left and Right arrow keys"
          onPointerDown={onDragStart}
          onKeyDown={onMoveKeyDown}
        >
          <svg
            width="8"
            height="12"
            viewBox="0 0 8 12"
            fill="currentColor"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="2" cy="2" r="1" />
            <circle cx="6" cy="2" r="1" />
            <circle cx="2" cy="6" r="1" />
            <circle cx="6" cy="6" r="1" />
            <circle cx="2" cy="10" r="1" />
            <circle cx="6" cy="10" r="1" />
          </svg>
        </button>

        <div
          className={`pane-layout${region.layout ? frameClass : ""}`}
          ref={groupSurfaceRef}
        >
          {region.layout ? (
            renderLayout(region.layout)
          ) : (
            <div
              className="region-empty"
              style={{ "--vt": `empty-${region.type}` } as CSSProperties}
            >
              {renderEmptyRegion(region.type)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
