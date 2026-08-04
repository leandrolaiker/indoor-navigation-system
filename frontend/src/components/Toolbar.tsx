import { EditorMode } from '../types';

interface ToolbarProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  hasEntrance: boolean;
  hasPlan: boolean;
  onSave: () => void;
  saving: boolean;
}

const HINTS: Record<EditorMode, string> = {
  move:
    'Arrastrá un POI para moverlo (doble clic para renombrarlo). En una conexión: doble clic sobre la línea agrega un punto de control para curvar el camino; arrastrá un punto para ajustarlo; doble clic sobre un punto lo elimina.',
  entrance: 'Hacé clic en el plano para ubicar la entrada principal.',
  poi: 'Hacé clic en el plano para agregar un nuevo POI.',
  connect: 'Hacé clic en un POI y luego en otro para conectarlos.',
  delete: 'Hacé clic en un POI, una conexión o una zona para eliminarla.',
  zone: 'Arrastrá sobre el plano para dibujar una zona (recuadro) y escribí su nombre.',
};

export default function Toolbar({
  mode,
  onModeChange,
  hasEntrance,
  hasPlan,
  onSave,
  saving,
}: ToolbarProps) {
  const disabled = !hasPlan;

  return (
    <div className="toolbar">
      <h4>Herramientas</h4>
      <button
        className={`tool-btn ${mode === 'move' ? 'active' : ''}`}
        onClick={() => onModeChange('move')}
        disabled={disabled}
      >
        🖐️ Mover
      </button>
      <button
        className={`tool-btn ${mode === 'entrance' ? 'active' : ''}`}
        onClick={() => onModeChange('entrance')}
        disabled={disabled}
      >
        🚪 {hasEntrance ? 'Reubicar entrada' : 'Definir entrada'}
      </button>
      <button
        className={`tool-btn ${mode === 'poi' ? 'active' : ''}`}
        onClick={() => onModeChange('poi')}
        disabled={disabled}
      >
        📍 Agregar POI
      </button>
      <button
        className={`tool-btn ${mode === 'connect' ? 'active' : ''}`}
        onClick={() => onModeChange('connect')}
        disabled={disabled}
      >
        🔗 Conectar
      </button>
      <button
        className={`tool-btn ${mode === 'zone' ? 'active' : ''}`}
        onClick={() => onModeChange('zone')}
        disabled={disabled}
      >
        🟪 Agregar zona
      </button>
      <button
        className={`tool-btn ${mode === 'delete' ? 'active' : ''}`}
        onClick={() => onModeChange('delete')}
        disabled={disabled}
      >
        🗑️ Eliminar
      </button>

      <p className="tool-hint">{disabled ? 'Subí un plano para empezar a editar.' : HINTS[mode]}</p>

      <h4>Mapa</h4>
      <button className="tool-btn" style={{ background: '#16a34a' }} onClick={onSave} disabled={disabled || saving}>
        {saving ? 'Guardando…' : '💾 Guardar y generar rutas'}
      </button>
    </div>
  );
}
