import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { CampaignProvider } from './contexts/CampaignContext';
import Dashboard from './components/Dashboard';
import './index.css';

function App() {
  return (
    <CampaignProvider>
      <Router>
        <div className="min-h-screen bg-gray-900">
          <Routes>
            <Route path="/" element={<Dashboard />} />
          </Routes>
        </div>
      </Router>
    </CampaignProvider>
  );
}

export default App;