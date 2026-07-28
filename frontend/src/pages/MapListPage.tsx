import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { mapApi } from '../api/mapApi';
import { MapEntity } from '../types';
import NamePromptModal from '../components/NamePromptModal';

export default function MapListPage() {
  const [maps, setMaps] = useState<MapEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadMaps = async () => {
    setLoading(true);
    try {
      setMaps(await mapApi.list());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMaps();
  }, []);

  const handleCreate = async (name: string) => {
    try {
      const created = await mapApi.create(name);
      setShowCreateModal(false);
      navigate(`/maps/${created._id}`);
    } catch (e) {
      setError((e as Error).message);
      setShowCreateModal(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('¿Eliminar este mapa? Esta acción no se puede deshacer.')) return;
    await mapApi.remove(id);
    loadMaps();
  };

  return (
    <div className="map-list-page">
      <div className="map-list-toolbar">
        <h2 style={{ flex: 1, margin: 0 }}>Mis mapas interiores</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Nuevo mapa
        </button>
      </div>

      {error && <div className="status-banner error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : maps.length === 0 ? (
        <div className="empty-state">
          <p>Todavía no creaste ningún mapa.</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            Crear el primero
          </button>
        </div>
      ) : (
        <div className="map-grid">
          {maps.map((map) => (
            <Link key={map._id} to={`/maps/${map._id}`} className="map-card">
              <h3>{map.name}</h3>
              <span className="meta">
                {map.floors[0]?.pois.length ?? 0} POIs ·{' '}
                {map.floors[0]?.planImagePath ? 'plano cargado' : 'sin plano'}
              </span>
              <button className="btn btn-secondary" onClick={(e) => handleDelete(map._id, e)}>
                Eliminar
              </button>
            </Link>
          ))}
        </div>
      )}

      {showCreateModal && (
        <NamePromptModal
          title="Nombre del nuevo mapa"
          confirmLabel="Crear"
          onConfirm={handleCreate}
          onCancel={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
