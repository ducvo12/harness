import type { HTMLAttributes, ReactNode } from "react";
import {
  minimumSize,
  splitDragGap,
  splitSeam,
  type SplitNode,
} from "../../layout/layout";

interface PaneSplitProps {
  split: SplitNode;
  separating: boolean;
  first: ReactNode;
  second: ReactNode;
  dividerProps: HTMLAttributes<HTMLDivElement>;
}

export default function PaneSplit({
  split,
  separating,
  first,
  second,
  dividerProps,
}: PaneSplitProps) {
  const firstSize = minimumSize(split.first);
  const secondSize = minimumSize(split.second);
  const gap = separating ? splitDragGap : splitSeam;
  const horizontal = split.axis === "horizontal";
  const dimension = horizontal ? "width" : "height";
  const tracks = `minmax(${firstSize[dimension]}px, ${split.ratio * 100}fr) ${gap}px minmax(${secondSize[dimension]}px, ${(1 - split.ratio) * 100}fr)`;

  return (
    <div
      className={`pane-split pane-split-${split.axis}`}
      style={
        horizontal
          ? { gridTemplateColumns: tracks }
          : { gridTemplateRows: tracks }
      }
    >
      {first}

      <div {...dividerProps} />

      {second}
    </div>
  );
}
