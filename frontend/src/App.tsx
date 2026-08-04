import { HashRouter, Route, Routes } from 'react-router-dom';
import MapListPage from './pages/MapListPage';
import MapEditorPage from './pages/MapEditorPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<MapListPage />} />
        <Route path="/maps/:id" element={<MapEditorPage />} />
      </Routes>
    </HashRouter>
  );
}
