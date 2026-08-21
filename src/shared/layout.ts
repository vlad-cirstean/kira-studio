export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  panel: {
    project: { visible: boolean; width: number };
    operations: { visible: boolean; height: number };
    cellEditor: { visible: boolean; height: number };
  };
  window: {
    bounds: WindowBounds | null;
  };
}

export interface LayoutPatch {
  panel?: {
    project?: Partial<Layout['panel']['project']>;
    operations?: Partial<Layout['panel']['operations']>;
    cellEditor?: Partial<Layout['panel']['cellEditor']>;
  };
  window?: Partial<Layout['window']>;
}

export const defaultLayout: Layout = {
  panel: {
    project: { visible: true, width: 260 },
    operations: { visible: false, height: 200 },
    cellEditor: { visible: true, height: 180 },
  },
  window: {
    bounds: null,
  },
};
