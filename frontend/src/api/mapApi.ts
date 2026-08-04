import { Edge, MapEntity, NavigationStep, Poi, Zone } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface PoiInstructionsResponse {
  poiId: string;
  poiName: string;
  entranceName: string;
  unidad: 'plano_px';
  pasos: NavigationStep[];
  textoGenerado: string | null;
  instructionsMode: 'auto' | 'manual';
  manualInstructions: string | null;
  texto: string | null;
  desactualizado: boolean;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const body = await response.json();
      message = body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return response.json() as Promise<T>;
}

export const mapApi = {
  async list(): Promise<MapEntity[]> {
    const res = await fetch(`${API_BASE_URL}/maps`);
    return handleResponse(res);
  },

  async get(id: string): Promise<MapEntity> {
    const res = await fetch(`${API_BASE_URL}/maps/${id}`);
    return handleResponse(res);
  },

  async create(name: string): Promise<MapEntity> {
    const res = await fetch(`${API_BASE_URL}/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse(res);
  },

  async rename(id: string, name: string): Promise<MapEntity> {
    const res = await fetch(`${API_BASE_URL}/maps/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return handleResponse(res);
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/maps/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Error ${res.status} eliminando el mapa`);
  },

  async uploadPlan(id: string, file: File): Promise<MapEntity> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE_URL}/maps/${id}/plan`, {
      method: 'POST',
      body: formData,
    });
    return handleResponse(res);
  },

  async saveGraph(id: string, pois: Poi[], edges: Edge[], zones: Zone[]): Promise<MapEntity> {
    const res = await fetch(`${API_BASE_URL}/maps/${id}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pois: pois.map(({ id: poiId, name, x, y, isEntrance }) => ({
          id: poiId,
          name,
          x,
          y,
          isEntrance,
        })),
        edges: edges.map(({ id: edgeId, fromPoiId, toPoiId, waypoints }) => ({
          id: edgeId,
          fromPoiId,
          toPoiId,
          waypoints: waypoints ?? [],
        })),
        zones: zones.map(({ id: zoneId, name, x, y, width, height }) => ({
          id: zoneId,
          name,
          x,
          y,
          width,
          height,
        })),
      }),
    });
    return handleResponse(res);
  },

  fileUrl(relativePath: string): string {
    return `${API_BASE_URL}/uploads/${relativePath}`;
  },

  generatedImageUrl(relativePath: string): string {
    return `${API_BASE_URL}/generated/${relativePath}`;
  },

  generatedImagesZipUrl(id: string): string {
    return `${API_BASE_URL}/maps/${id}/generated/download`;
  },

  instructionsUrl(mapId: string, poiId: string): string {
    return `${API_BASE_URL}/maps/${mapId}/pois/${poiId}/instructions`;
  },

  async getInstructions(mapId: string, poiId: string): Promise<PoiInstructionsResponse> {
    const res = await fetch(this.instructionsUrl(mapId, poiId));
    return handleResponse(res);
  },

  async updateManualInstructions(
    mapId: string,
    poiId: string,
    manualInstructions: string | null,
  ): Promise<PoiInstructionsResponse> {
    const res = await fetch(this.instructionsUrl(mapId, poiId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualInstructions }),
    });
    return handleResponse(res);
  },
};
