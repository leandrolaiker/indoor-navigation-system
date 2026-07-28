import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { v4 as uuid } from 'uuid';
import { mapApi } from '../api/mapApi';
import { Edge, EditorMode, MapEntity, Poi, Zone } from '../types';
import Toolbar from '../components/Toolbar';
import CanvasEditor from '../components/CanvasEditor';
import NamePromptModal from '../components/NamePromptModal';

type PendingAction =
  | { type: 'new-poi'; x: number; y: number }
  | { type: 'rename-poi'; poiId: string }
  | { type: 'new-zone'; x: number; y: number; width: number; height: number }
  | { type: 'rename-zone'; zoneId: string }
  | null;

export default function MapEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [map, setMap] = useState<MapEntity | null>(null);
  const [pois, setPois] = useState<Poi[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [mode, setMode] = useState<EditorMode>('move');
  const [pendingConnectPoiId, setPendingConnectPoiId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMap = useCallback(async () => {
    if (!id) return;
    const fetched = await mapApi.get(id);
    setMap(fetched);
    setPois(fetched.floors[0]?.pois ?? []);
    setEdges(fetched.floors[0]?.edges ?? []);
    setZones(fetched.floors[0]?.zones ?? []);
  }, [id]);

  useEffect(() => {
    loadMap().catch((e) => setStatus({ type: 'error', text: (e as Error).message }));
  }, [loadMap]);

  const floor = map?.floors[0];
  const hasPlan = Boolean(floor?.planImagePath);
  const hasEntrance = pois.some((p) => p.isEntrance);

  const showStatus = (type: 'success' | 'error' | 'info', text: string) => {
    setStatus({ type, text });
    window.clearTimeout((showStatus as any)._t);
    (showStatus as any)._t = window.setTimeout(() => setStatus(null), 4000);
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id) return;
    setUploading(true);
    try {
      const updated = await mapApi.uploadPlan(id, file);
      setMap(updated);
      showStatus('success', 'Plano cargado correctamente.');
    } catch (err) {
      showStatus('error', (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleCanvasClick = (x: number, y: number) => {
    if (mode === 'poi') {
      setPendingAction({ type: 'new-poi', x, y });
    } else if (mode === 'entrance') {
      setPois((prev) => {
        const existing = prev.find((p) => p.isEntrance);
        if (existing) {
          return prev.map((p) => (p.isEntrance ? { ...p, x, y } : p));
        }
        return [
          ...prev,
          {
            id: uuid(),
            name: 'Entrada principal',
            x,
            y,
            isEntrance: true,
            generatedImagePath: null,
            instructions: null,
          },
        ];
      });
    } else if (mode === 'connect') {
      setPendingConnectPoiId(null);
    }
  };

  const handlePoiClick = (poiId: string) => {
    if (mode === 'connect') {
      if (!pendingConnectPoiId) {
        setPendingConnectPoiId(poiId);
        return;
      }
      if (pendingConnectPoiId === poiId) {
        setPendingConnectPoiId(null);
        return;
      }
      const already = edges.some(
        (e) =>
          (e.fromPoiId === pendingConnectPoiId && e.toPoiId === poiId) ||
          (e.fromPoiId === poiId && e.toPoiId === pendingConnectPoiId),
      );
      if (!already) {
        setEdges((prev) => [
          ...prev,
          { id: uuid(), fromPoiId: pendingConnectPoiId, toPoiId: poiId, waypoints: [] },
        ]);
      }
      setPendingConnectPoiId(null);
    } else if (mode === 'delete') {
      const poi = pois.find((p) => p.id === poiId);
      if (poi?.isEntrance && !confirm('Este es el nodo de entrada principal. ¿Eliminarlo igual?')) {
        return;
      }
      setPois((prev) => prev.filter((p) => p.id !== poiId));
      setEdges((prev) => prev.filter((e) => e.fromPoiId !== poiId && e.toPoiId !== poiId));
    }
  };

  const handlePoiDoubleClick = (poiId: string) => {
    setPendingAction({ type: 'rename-poi', poiId });
  };

  const handlePoiDragEnd = (poiId: string, x: number, y: number) => {
    setPois((prev) => prev.map((p) => (p.id === poiId ? { ...p, x, y } : p)));
  };

  const handleEdgeClick = (edgeId: string) => {
    if (mode !== 'delete') return;
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
  };

  const handleEdgeAddWaypoint = (edgeId: string, segmentIndex: number, x: number, y: number) => {
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id !== edgeId) return e;
        const waypoints = [...(e.waypoints ?? [])];
        waypoints.splice(segmentIndex, 0, { x, y });
        return { ...e, waypoints };
      }),
    );
  };

  const handleWaypointDragEnd = (edgeId: string, waypointIndex: number, x: number, y: number) => {
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id !== edgeId) return e;
        const waypoints = [...(e.waypoints ?? [])];
        waypoints[waypointIndex] = { x, y };
        return { ...e, waypoints };
      }),
    );
  };

  const handleWaypointRemove = (edgeId: string, waypointIndex: number) => {
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id !== edgeId) return e;
        const waypoints = (e.waypoints ?? []).filter((_, idx) => idx !== waypointIndex);
        return { ...e, waypoints };
      }),
    );
  };

  const handleZoneDrawEnd = (x: number, y: number, width: number, height: number) => {
    setPendingAction({ type: 'new-zone', x, y, width, height });
  };

  const handleZoneClick = (zoneId: string) => {
    if (mode !== 'delete') return;
    setZones((prev) => prev.filter((z) => z.id !== zoneId));
  };

  const handleZoneDoubleClick = (zoneId: string) => {
    setPendingAction({ type: 'rename-zone', zoneId });
  };

  const handleSave = async () => {
    if (!id) return;
    if (!hasEntrance) {
      showStatus('error', 'Definí la entrada principal antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const updated = await mapApi.saveGraph(id, pois, edges, zones);
      setMap(updated);
      setPois(updated.floors[0]?.pois ?? []);
      setEdges(updated.floors[0]?.edges ?? []);
      setZones(updated.floors[0]?.zones ?? []);
      showStatus('success', 'Mapa guardado. Imágenes de ruta generadas.');
    } catch (err) {
      showStatus('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!map || !floor) {
    return <p style={{ padding: 24 }}>Cargando mapa…</p>;
  }

  return (
    <div className="editor-page">
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>
            ← Mapas
          </Link>
          <h1>{map.name}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={handleFileSelected}
          />
          <button className="btn btn-secondary" onClick={handleUploadClick} disabled={uploading}>
            {uploading ? 'Subiendo…' : hasPlan ? 'Reemplazar plano' : 'Subir plano'}
          </button>
          {pois.some((p) => !p.isEntrance && p.generatedImagePath) && (
            <a
              className="btn btn-secondary"
              href={mapApi.generatedImagesZipUrl(map._id)}
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
            >
              ⬇️ Descargar imágenes (.zip)
            </a>
          )}
        </div>
      </header>

      {status && <div className={`status-banner ${status.type}`}>{status.text}</div>}

      <div className="editor-body">
        <Toolbar
          mode={mode}
          onModeChange={setMode}
          hasEntrance={hasEntrance}
          hasPlan={hasPlan}
          onSave={handleSave}
          saving={saving}
        />

        {hasPlan ? (
          <CanvasEditor
            planImageUrl={mapApi.fileUrl(floor.planImagePath!)}
            planWidth={floor.planImageWidth}
            planHeight={floor.planImageHeight}
            pois={pois}
            edges={edges}
            zones={zones}
            mode={mode}
            onCanvasClick={handleCanvasClick}
            onPoiClick={handlePoiClick}
            onPoiDoubleClick={handlePoiDoubleClick}
            onPoiDragEnd={handlePoiDragEnd}
            onEdgeClick={handleEdgeClick}
            onEdgeAddWaypoint={handleEdgeAddWaypoint}
            onWaypointDragEnd={handleWaypointDragEnd}
            onWaypointRemove={handleWaypointRemove}
            onZoneDrawEnd={handleZoneDrawEnd}
            onZoneClick={handleZoneClick}
            onZoneDoubleClick={handleZoneDoubleClick}
            pendingConnectionPoiId={pendingConnectPoiId}
          />
        ) : (
          <div className="canvas-area">
            <div className="canvas-placeholder">
              <p>Subí una imagen del plano (PNG o JPG) para empezar a editar el mapa.</p>
              <button className="btn btn-primary" onClick={handleUploadClick} disabled={uploading}>
                {uploading ? 'Subiendo…' : 'Subir plano'}
              </button>
            </div>
          </div>
        )}

        <div className="side-panel">
          <h4>POIs ({pois.length})</h4>
          {pois.length === 0 && <p style={{ fontSize: 13, color: '#64748b' }}>Todavía no hay POIs.</p>}
          {pois.map((poi) => (
            <div key={poi.id}>
              <div className="poi-row">
                <span>{poi.name}</span>
                {poi.isEntrance && <span className="badge">Entrada</span>}
              </div>
              {!poi.isEntrance && poi.generatedImagePath && (
                <img
                  className="route-thumb"
                  src={mapApi.generatedImageUrl(poi.generatedImagePath)}
                  alt={`Ruta hacia ${poi.name}`}
                />
              )}
              {!poi.isEntrance && poi.instructions && (
                <a
                  href={mapApi.instructionsUrl(map._id, poi.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, display: 'inline-block', marginTop: 4 }}
                >
                  📋 Ver instrucciones (JSON)
                </a>
              )}
            </div>
          ))}

          <h4 style={{ marginTop: 18 }}>Zonas ({zones.length})</h4>
          {zones.length === 0 && (
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Todavía no hay zonas. Usá "▭ Agregar zona" y arrastrá sobre el plano.
            </p>
          )}
          {zones.map((zone) => (
            <div className="poi-row" key={zone.id}>
              <span>▭ {zone.name}</span>
            </div>
          ))}
        </div>
      </div>

      {pendingAction?.type === 'new-poi' && (
        <NamePromptModal
          title="Nombre del POI"
          confirmLabel="Agregar"
          onConfirm={(name) => {
            setPois((prev) => [
              ...prev,
              {
                id: uuid(),
                name,
                x: pendingAction.x,
                y: pendingAction.y,
                isEntrance: false,
                generatedImagePath: null,
                instructions: null,
              },
            ]);
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'rename-poi' && (
        <NamePromptModal
          title="Renombrar POI"
          confirmLabel="Guardar"
          initialValue={pois.find((p) => p.id === pendingAction.poiId)?.name ?? ''}
          onConfirm={(name) => {
            setPois((prev) =>
              prev.map((p) => (p.id === pendingAction.poiId ? { ...p, name } : p)),
            );
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'new-zone' && (
        <NamePromptModal
          title="Nombre de la zona"
          confirmLabel="Agregar"
          onConfirm={(name) => {
            setZones((prev) => [
              ...prev,
              {
                id: uuid(),
                name,
                x: pendingAction.x,
                y: pendingAction.y,
                width: pendingAction.width,
                height: pendingAction.height,
              },
            ]);
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {pendingAction?.type === 'rename-zone' && (
        <NamePromptModal
          title="Renombrar zona"
          confirmLabel="Guardar"
          initialValue={zones.find((z) => z.id === pendingAction.zoneId)?.name ?? ''}
          onConfirm={(name) => {
            setZones((prev) =>
              prev.map((z) => (z.id === pendingAction.zoneId ? { ...z, name } : z)),
            );
            setPendingAction(null);
          }}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
