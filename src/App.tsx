import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { CampaignProvider, useCampaign } from './contexts/CampaignContext';
import { NotificationProvider, useNotifications } from './contexts/NotificationContext';
import Dashboard from './components/Dashboard';
import Login from './components/Login';
import NotificationSystem from './components/NotificationSystem';
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

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if user is already authenticated
    const token = localStorage.getItem('whatsapp_auth_token');
    const savedUser = localStorage.getItem('whatsapp_user');

    if (token && savedUser) {
      // Validate token with server
      fetch('http://localhost:3001/api/auth/validate', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          setIsAuthenticated(true);
        } else {
          // Token is invalid, clear storage
          localStorage.removeItem('whatsapp_auth_token');
          localStorage.removeItem('whatsapp_user');
        }
        setIsLoading(false);
      })
      .catch(() => {
        // Server error, clear storage
        localStorage.removeItem('whatsapp_auth_token');
        localStorage.removeItem('whatsapp_user');
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleLogin = (_token: string, _userData: any) => {
    setIsAuthenticated(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <CampaignProvider>
      <AuthenticatedApp />
    </CampaignProvider>
  );
}

export default App;