export interface VideoTile {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  containerWidth: number;
  containerHeight: number;
  participantCount: number;
  gap?: number;
  aspectRatio?: number;
  minTileSize?: number;
  /** When true, a spotlight area is reserved for screen share and participants are laid out in a strip */
  spotlight?: boolean;
}

export interface SpotlightArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridLayout {
  tiles: VideoTile[];
  rows: number;
  cols: number;
  tileWidth: number;
  tileHeight: number;
  /** Present only in spotlight mode: the area reserved for the screen share */
  spotlightArea?: SpotlightArea;
  /** 'right' | 'bottom' — which side the participant strip is on (spotlight mode only) */
  stripPosition?: "right" | "bottom";
}
