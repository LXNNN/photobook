import { Routes, Route, Navigate } from 'react-router-dom';
import ProjectList from './pages/ProjectList';
import Editor from './pages/Editor';
import Viewer from './pages/Viewer';
import CreateWizard from './pages/CreateWizard';

function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectList />} />
      <Route path="/create" element={<CreateWizard />} />
      <Route path="/editor/:projectId" element={<Editor />} />
      <Route path="/viewer/:projectId" element={<Viewer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
