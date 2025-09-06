import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { CampaignProvider, useCampaign } from './contexts/CampaignContext';
import { NotificationProvider, useNotifications } from './contexts/NotificationContext';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import NotificationSystem from './components/NotificationSystem';
import config from './config';
import './index.css';

// Component that initializes the socket after CampaignProvider is ready
function AuthenticatedApp() {
  const { initializeSocket, closeSocket } = useCampaign();
  
  useEffect(() => {
    // Initialize socket connection when component mounts (after authentication)
    initializeSocket();
    
    // Cleanup function to close socket when component unmounts
    return () => {
      closeSocket();
    };
  }, []); // Empty dependency array - only run once on mount

  return (
    <NotificationProvider maxNotifications={10}>
      <Router>
        <div className="min-h-screen bg-gray-900">
          <Routes>
            <Route path="/" element={<Dashboard />} />
          </Routes>
          <NotificationSystemWrapper />
        </div>
      </Router>
    </NotificationProvider>
  );
}

// Wrapper component to access notification context
function NotificationSystemWrapper() {
  const { notifications, removeNotification } = useNotifications();
  
  return (
    <NotificationSystem 
      notifications={notifications} 
      onClose={removeNotification} 
    />
  );
}

interface User {
  id: string;
  username: string;
  email: string;
  lastLogin?: string;
  settings?: any;
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('whatsapp_auth_token'); // Updated key
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        // FIX: Use config instead of hardcoded URL
        const response = await fetch(`${config.API_BASE_URL}/api/auth/validate`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem('whatsapp_auth_token');
          localStorage.removeItem('whatsapp_user');
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('whatsapp_auth_token');
        localStorage.removeItem('whatsapp_user');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const handleLogin = (token: string, userData: User) => {
    setUser(userData);
    setIsAuthenticated(true);
    localStorage.setItem('whatsapp_auth_token', token);
    localStorage.setItem('whatsapp_user', JSON.stringify(userData));
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUser(null);
    localStorage.removeItem('whatsapp_auth_token');
    localStorage.removeItem('whatsapp_user');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <CampaignProvider>
      {!isAuthenticated ? (
        <Login onLogin={handleLogin} />
      ) : (
        <AuthenticatedApp />
      )}
    </CampaignProvider>
  );
}

export default App;