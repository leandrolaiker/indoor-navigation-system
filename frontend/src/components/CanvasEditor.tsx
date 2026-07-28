import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import Konva from 'konva';
import { Edge, EditorMode, Poi, Zone } from '../types';

interface CanvasEditorProps {
  planImageUrl: string;
  planWidth: number;
  planHeight: number;
  pois: Poi[];
  edges: Edge[];
  zones: Zone[];
  mode: EditorMode;
  onCanvasClick: (x: number, y: number) => void;
  onPoiClick: (poiId: string) => void;
  onPoiDoubleClick: (poiId: string) => void;
  onPoiDragEnd: (poiId: string, x: number, y: number) => void;
  onEdgeClick: (edgeId: string) => void;
  onEdgeAddWaypoint: (edgeId: string, segmentIndex: number, x: number, y: number) => void;
  onWaypointDragEnd: (edgeId: string, waypointIndex: number, x: number, y: number) => void;
  onWaypointRemove: (edgeId: string, waypointIndex: number) => void;
  onZoneDrawEnd: (x: number, y: number, width: number, height: number) => void;
  onZoneClick: (zoneId: string) => void;
  onZoneDoubleClick: (zoneId: string) => void;
  pendingConnectionPoiId: string | null;
}

const MIN_ZONE_SIZE = 6;

function usePlanImage(url: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    setImage(null);
    const img = new window.Image();
    img.src = url;
    img.onload = () => setImage(img);
    img.onerror = () => {
      // eslint-disable-next-line no-console
      console.error('No se pudo cargar la imagen del plano:', url);
    };
  }, [url]);
  return image;
}

const STAGE_PADDING = 40;

/** Distancia de un punto (px,py) al segmento [a,b]. Usado para saber en qué
 * tramo de un camino (posiblemente con waypoints) se hizo doble clic. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

export default function CanvasEditor({
  planImageUrl,
  planWidth,
  planHeight,
  pois,
  edges,
  zones,
  mode,
  onCanvasClick,
  onPoiClick,
  onPoiDoubleClick,
  onPoiDragEnd,
  onEdgeClick,
  onEdgeAddWaypoint,
  onWaypointDragEnd,
  onWaypointRemove,
  onZoneDrawEnd,
  onZoneClick,
  onZoneDoubleClick,
  pendingConnectionPoiId,
}: CanvasEditorProps) {
  const image = usePlanImage(planImageUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [stageScale, setStageScale] = useState(1);
  const [fitted, setFitted] = useState(false);
  const [zoneDraft, setZoneDraft] = useState<{
    startX: number;
    startY: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ajustar automáticamente el zoom inicial para que el plano completo sea visible
  useEffect(() => {
    if (fitted || !planWidth || !planHeight || size.width === 0) return;
    const scaleX = (size.width - STAGE_PADDING * 2) / planWidth;
    const scaleY = (size.height - STAGE_PADDING * 2) / planHeight;
    const scale = Math.min(scaleX, scaleY, 1.5);
    setStageScale(scale > 0 ? scale : 1);
    setStagePos({
      x: (size.width - planWidth * scale) / 2,
      y: (size.height - planHeight * scale) / 2,
    });
    setFitted(true);
  }, [planWidth, planHeight, size, fitted]);

  const poiById = useMemo(() => new Map(pois.map((p) => [p.id, p])), [pois]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const scaleBy = 1.08;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clamped = Math.min(Math.max(newScale, 0.1), 5);

    setStageScale(clamped);
    setStagePos({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  };

  const zoomBy = (factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const center = { x: size.width / 2, y: size.height / 2 };
    const oldScale = stageScale;
    const newScale = Math.min(Math.max(oldScale * factor, 0.1), 5);
    const mousePointTo = {
      x: (center.x - stagePos.x) / oldScale,
      y: (center.y - stagePos.y) / oldScale,
    };
    setStageScale(newScale);
    setStagePos({
      x: center.x - mousePointTo.x * newScale,
      y: center.y - mousePointTo.y * newScale,
    });
  };

  const getPlanPointerPosition = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - stagePos.x) / stageScale,
      y: (pointer.y - stagePos.y) / stageScale,
    };
  };

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // El modo "zone" se maneja con mousedown/mousemove/mouseup (arrastre),
    // no con un clic simple: se ignora acá para no crear nada extra.
    if (mode === 'zone') return;
    // Solo reaccionar a clics directos sobre el fondo (no sobre POIs/edges, que
    // manejan su propio evento y detienen la propagación).
    if (e.target !== e.target.getStage() && e.target.name() !== 'plan-background') return;
    const pos = getPlanPointerPosition();
    if (!pos) return;
    onCanvasClick(pos.x, pos.y);
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (mode !== 'zone') return;
    if (e.target !== e.target.getStage() && e.target.name() !== 'plan-background') return;
    const pos = getPlanPointerPosition();
    if (!pos) return;
    setZoneDraft({ startX: pos.x, startY: pos.y, x: pos.x, y: pos.y, width: 0, height: 0 });
  };

  const handleStageMouseMove = () => {
    if (mode !== 'zone' || !zoneDraft) return;
    const pos = getPlanPointerPosition();
    if (!pos) return;
    const x = Math.min(zoneDraft.startX, pos.x);
    const y = Math.min(zoneDraft.startY, pos.y);
    const width = Math.abs(pos.x - zoneDraft.startX);
    const height = Math.abs(pos.y - zoneDraft.startY);
    setZoneDraft({ ...zoneDraft, x, y, width, height });
  };

  const handleStageMouseUp = () => {
    if (mode !== 'zone' || !zoneDraft) return;
    if (zoneDraft.width >= MIN_ZONE_SIZE && zoneDraft.height >= MIN_ZONE_SIZE) {
      onZoneDrawEnd(zoneDraft.x, zoneDraft.y, zoneDraft.width, zoneDraft.height);
    }
    setZoneDraft(null);
  };

  const cursorForMode: Record<EditorMode, string> = {
    move: 'default',
    entrance: 'crosshair',
    poi: 'crosshair',
    connect: 'pointer',
    delete: 'not-allowed',
    zone: 'crosshair',
  };

  return (
    <div ref={containerRef} className="canvas-area" style={{ cursor: cursorForMode[mode] }}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={stageScale}
        draggable={mode === 'move'}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        <Layer>
          {image && (
            <KonvaImage
              image={image}
              name="plan-background"
              width={planWidth}
              height={planHeight}
            />
          )}

          {zones.map((zone) => (
            <Group key={zone.id}>
              <Rect
                x={zone.x}
                y={zone.y}
                width={zone.width}
                height={zone.height}
                fill="rgba(124, 58, 237, 0.12)"
                stroke="rgba(124, 58, 237, 0.7)"
                strokeWidth={1.5 / stageScale}
                dash={[6 / stageScale, 4 / stageScale]}
                onClick={(e) => {
                  if (mode !== 'delete') return;
                  e.cancelBubble = true;
                  onZoneClick(zone.id);
                }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  onZoneDoubleClick(zone.id);
                }}
              />
              <Text
                text={zone.name}
                x={zone.x + 4 / stageScale}
                y={zone.y + 4 / stageScale}
                fontSize={12 / stageScale}
                fontStyle="bold"
                fill="#5b21b6"
                listening={false}
              />
            </Group>
          ))}

          {zoneDraft && (
            <Rect
              x={zoneDraft.x}
              y={zoneDraft.y}
              width={zoneDraft.width}
              height={zoneDraft.height}
              fill="rgba(124, 58, 237, 0.18)"
              stroke="rgba(124, 58, 237, 0.9)"
              strokeWidth={1.5 / stageScale}
              dash={[4 / stageScale, 3 / stageScale]}
              listening={false}
            />
          )}

          {edges.map((edge) => {
            const from = poiById.get(edge.fromPoiId);
            const to = poiById.get(edge.toPoiId);
            if (!from || !to) return null;
            const waypoints = edge.waypoints ?? [];
            const allPoints = [from, ...waypoints, to];
            const flatPoints = allPoints.flatMap((p) => [p.x, p.y]);
            return (
              <Group key={edge.id}>
                <Line
                  points={flatPoints}
                  stroke="#2563eb"
                  strokeWidth={4 / stageScale}
                  hitStrokeWidth={16 / stageScale}
                  onClick={(e) => {
                    if (mode !== 'delete') return;
                    e.cancelBubble = true;
                    onEdgeClick(edge.id);
                  }}
                  onDblClick={(e) => {
                    if (mode !== 'move') return;
                    e.cancelBubble = true;
                    const stage = stageRef.current;
                    if (!stage) return;
                    const pointer = stage.getPointerPosition();
                    if (!pointer) return;
                    const x = (pointer.x - stagePos.x) / stageScale;
                    const y = (pointer.y - stagePos.y) / stageScale;
                    let bestSegment = 0;
                    let bestDist = Infinity;
                    for (let i = 0; i < allPoints.length - 1; i += 1) {
                      const a = allPoints[i];
                      const b = allPoints[i + 1];
                      const dist = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
                      if (dist < bestDist) {
                        bestDist = dist;
                        bestSegment = i;
                      }
                    }
                    onEdgeAddWaypoint(edge.id, bestSegment, x, y);
                  }}
                />
                {waypoints.map((wp, idx) => (
                  <Circle
                    key={idx}
                    x={wp.x}
                    y={wp.y}
                    radius={5 / stageScale}
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth={1.5 / stageScale}
                    draggable={mode === 'move'}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      onWaypointDragEnd(edge.id, idx, e.target.x(), e.target.y());
                    }}
                    onDblClick={(e) => {
                      if (mode !== 'move') return;
                      e.cancelBubble = true;
                      onWaypointRemove(edge.id, idx);
                    }}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                    }}
                  />
                ))}
              </Group>
            );
          })}

          {pois.map((poi) => {
            const isPending = pendingConnectionPoiId === poi.id;
            const radius = (poi.isEntrance ? 12 : 9) / stageScale;
            return (
              <Group
                key={poi.id}
                x={poi.x}
                y={poi.y}
                draggable={mode === 'move'}
                onDragEnd={(e) => onPoiDragEnd(poi.id, e.target.x(), e.target.y())}
                onClick={(e) => {
                  e.cancelBubble = true;
                  onPoiClick(poi.id);
                }}
                onDblClick={(e) => {
                  e.cancelBubble = true;
                  onPoiDoubleClick(poi.id);
                }}
                onMouseDown={(e) => {
                  e.cancelBubble = true;
                }}
              >
                <Circle
                  radius={radius}
                  fill={poi.isEntrance ? '#16a34a' : isPending ? '#f59e0b' : '#dc2626'}
                  stroke="#ffffff"
                  strokeWidth={2 / stageScale}
                />
                <Text
                  text={poi.name}
                  fontSize={13 / stageScale}
                  fontStyle="bold"
                  fill="#0f172a"
                  y={radius + 4 / stageScale}
                  x={-60 / stageScale}
                  width={120 / stageScale}
                  align="center"
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>

      <div className="zoom-controls">
        <button className="btn btn-secondary" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button className="btn btn-secondary" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button className="btn btn-secondary" onClick={() => setFitted(false)}>
          Ajustar
        </button>
      </div>
    </div>
  );
}
